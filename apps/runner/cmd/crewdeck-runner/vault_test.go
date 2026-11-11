package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

// seal seals an item as the page does, from the raw vault key: a fresh item
// key under the vault key, the content under the item key.
func (v *fakeVault) seal(t *testing.T, plaintext, aad string) keys.SealedItem {
	t.Helper()
	itemKey, err := keys.GenerateAESKey()
	if err != nil {
		t.Fatal(err)
	}
	sealedKey, err := keys.AESGCMSeal(v.key, itemKey, append([]byte("crewdeck/v1/item-key"), aad...))
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, err := keys.AESGCMSeal(itemKey, []byte(plaintext), []byte(aad))
	if err != nil {
		t.Fatal(err)
	}
	return keys.SealedItem{Key: sealedKey, Ciphertext: ciphertext}
}

// After the link, the Runner restarts in another process: it opens its vault
// from runner.key and vault.wrap alone, and exchanges items with the page
// both ways.
func TestTheRunnerReopensItsVaultFromItsFilesAfterARestart(t *testing.T) {
	fake := &fakeLink{polls: []string{linked}}
	srv := httptest.NewServer(fake.handler(t))
	t.Cleanup(srv.Close)
	h := newHarness(t, srv.URL, "claude")
	if err := h.linker.link(context.Background(), code); err != nil {
		t.Fatalf("link: %v", err)
	}

	vault, err := openVault(state.Store{Dir: h.home})
	if err != nil {
		t.Fatalf("openVault: %v", err)
	}
	if vault.Version != 1 {
		t.Fatalf("vault version %d", vault.Version)
	}
	page := &fakeVault{key: fake.browser.vaultKey}

	fromRunner, err := vault.SealItem([]byte("le résumé d’une Session"), []byte("session_1:summary"))
	if err != nil {
		t.Fatal(err)
	}
	if got := page.open(t, fromRunner, "session_1:summary"); got != "le résumé d’une Session" {
		t.Fatalf("the page opens %q", got)
	}
	fromPage := page.seal(t, "une Idée", "idea_1:text")
	got, err := vault.OpenItem(fromPage, []byte("idea_1:text"))
	if err != nil || string(got) != "une Idée" {
		t.Fatalf("the Runner opens %q (%v)", got, err)
	}
	if _, err := vault.OpenItem(fromPage, []byte("idea_2:text")); err == nil {
		t.Fatal("an item opened under another item's aad")
	}
}

// A Runner whose keys are missing, or whose wrap no longer opens, refuses to
// run and says how to link it again.
func TestRunRefusesARunnerWhoseVaultDoesNotOpen(t *testing.T) {
	cases := map[string]struct {
		alter func(t *testing.T, home string)
		want  string
	}{
		"no runner.key": {
			alter: func(t *testing.T, home string) { remove(t, home+"/"+state.RunnerKeyFile) },
			want:  "pas de clé du coffre",
		},
		"no vault.wrap": {
			alter: func(t *testing.T, home string) { remove(t, home+"/"+state.VaultWrapFile) },
			want:  "pas de clé du coffre",
		},
		"a wrap sealed for another Runner": {
			alter: func(t *testing.T, home string) {
				store := state.Store{Dir: home}
				w, err := store.LoadVaultWrap()
				if err != nil {
					t.Fatal(err)
				}
				w.RunnerID = "another-runner"
				if err := store.SaveVaultWrap(w); err != nil {
					t.Fatal(err)
				}
			},
			want: "ne s’ouvre pas",
		},
		"a tampered wrap": {
			alter: func(t *testing.T, home string) {
				store := state.Store{Dir: home}
				w, err := store.LoadVaultWrap()
				if err != nil {
					t.Fatal(err)
				}
				w.Ciphertext[0] ^= 1
				if err := store.SaveVaultWrap(w); err != nil {
					t.Fatal(err)
				}
			},
			want: "ne s’ouvre pas",
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			home := t.TempDir()
			t.Setenv(state.HomeEnv, home)
			linkedHome(t, home, "http://127.0.0.1:1")
			c.alter(t, home)

			root := newRootCommand()
			root.SetErr(io.Discard)
			root.SetArgs([]string{"run"})
			err := root.Execute()
			if err == nil || !strings.Contains(err.Error(), c.want) || !strings.Contains(err.Error(), "crewdeck-runner link <code>") {
				t.Fatalf("run = %v, want %q and the command again", err, c.want)
			}
		})
	}
}

// linkedHome writes what a link leaves: runner.json, runner.key and a
// vault.wrap an Appareil sealed for this Runner.
func linkedHome(t *testing.T, home, server string) {
	t.Helper()
	store := state.Store{Dir: home}
	if err := store.Save(state.State{Server: server, RunnerID: runnerID, Token: "rnr_linked"}); err != nil {
		t.Fatal(err)
	}
	runner, _ := keys.GenerateKeyPair()
	device, _ := keys.GenerateKeyPair()
	vaultKey, _ := keys.GenerateAESKey()
	w, err := keys.SealWrap(device, keys.PublicKeyBytes(runner), vaultKey, []byte(keys.InfoVaultWrap), keys.VaultWrapAAD(runnerID, 1))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveRunnerKey(runner.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveVaultWrap(state.VaultWrap{RunnerID: runnerID, VaultKeyVersion: 1, DevicePublicKey: keys.PublicKeyBytes(device), Enc: w.Enc, Ciphertext: w.Ciphertext, Tag: w.Tag}); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(mustRead(t, home+"/"+state.VaultWrapFile), vaultKey) {
		t.Fatal("vault.wrap holds the vault key")
	}
}

func remove(t *testing.T, path string) {
	t.Helper()
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// ProbeEnv names the directory of TestVaultProbe's exchange.
const ProbeEnv = "CREWDECK_VAULT_PROBE"

type probeItem struct {
	AAD        string `json:"aad"`
	Key        string `json:"key"`
	Ciphertext string `json:"ciphertext"`
}

type probeIn struct {
	// FromPage is an item the page sealed.
	FromPage probeItem `json:"fromPage"`
	// ToPage is what the Runner seals for the page: its plaintext, its aad.
	ToPage struct {
		AAD       string `json:"aad"`
		Plaintext string `json:"plaintext"`
	} `json:"toPage"`
}

type probeOut struct {
	Opened string    `json:"opened"`
	Sealed probeItem `json:"sealed"`
}

// TestVaultProbe is the Runner's side of the server's integration test of the
// first Appareil (apps/server/test/integration/first-appareil.spec.ts), which
// runs it once a real `crewdeck-runner link` linked a CREWDECK_HOME: as `run`
// at start, it opens the vault from runner.key and vault.wrap, opens the
// page's item of in.json and seals one for the page in out.json. Skipped
// without CREWDECK_VAULT_PROBE.
func TestVaultProbe(t *testing.T) {
	dir := os.Getenv(ProbeEnv)
	if dir == "" {
		t.Skip(ProbeEnv + " is not set: the server's integration test runs this probe")
	}
	store, err := state.Default()
	if err != nil {
		t.Fatal(err)
	}
	vault, err := openVault(store)
	if err != nil {
		t.Fatalf("openVault: %v", err)
	}
	var in probeIn
	if err := json.Unmarshal(mustRead(t, dir+"/in.json"), &in); err != nil {
		t.Fatal(err)
	}
	opened, err := vault.OpenItem(keys.SealedItem{Key: unb64(t, in.FromPage.Key), Ciphertext: unb64(t, in.FromPage.Ciphertext)}, []byte(in.FromPage.AAD))
	if err != nil {
		t.Fatalf("the page's item: %v", err)
	}
	sealed, err := vault.SealItem([]byte(in.ToPage.Plaintext), []byte(in.ToPage.AAD))
	if err != nil {
		t.Fatal(err)
	}
	out, _ := json.Marshal(probeOut{Opened: string(opened), Sealed: probeItem{AAD: in.ToPage.AAD, Key: b64(sealed.Key), Ciphertext: b64(sealed.Ciphertext)}})
	if err := os.WriteFile(dir+"/out.json", out, 0o600); err != nil {
		t.Fatal(err)
	}
}
