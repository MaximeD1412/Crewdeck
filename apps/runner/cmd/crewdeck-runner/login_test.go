package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/accounts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/fake"
)

// memoryKeyring is a keychain that answers, in memory.
type memoryKeyring map[string]string

func (k memoryKeyring) Get(service, user string) (string, error) {
	if v, ok := k[service+"/"+user]; ok {
		return v, nil
	}
	return "", accounts.ErrKeyringNotFound
}
func (k memoryKeyring) Set(service, user, secret string) error {
	k[service+"/"+user] = secret
	return nil
}
func (k memoryKeyring) Delete(service, user string) error {
	if _, ok := k[service+"/"+user]; !ok {
		return accounts.ErrKeyringNotFound
	}
	delete(k, service+"/"+user)
	return nil
}

// noKeyring is a machine without a keychain.
type noKeyring struct{}

func (noKeyring) Get(string, string) (string, error) { return "", errors.New("no Secret Service") }
func (noKeyring) Set(string, string, string) error   { return errors.New("no Secret Service") }
func (noKeyring) Delete(string, string) error        { return errors.New("no Secret Service") }

// accountsHarness is a login command against fake Moteurs reading the same
// store, its capabilities recorded as the running Runner would send them.
type accountsHarness struct {
	cli     *accountsCLI
	out     *bytes.Buffer
	sent    []contracts.RunnerCapabilities
	ran     [][]string
	running bool
}

func newAccountsHarness(t *testing.T, keychain accounts.Keyring, input string, secret string) *accountsHarness {
	t.Helper()
	h := &accountsHarness{out: &bytes.Buffer{}, running: true}
	store := accounts.Store{Keyring: keychain, Dir: filepath.Join(t.TempDir(), "secrets")}
	var registry engine.Registry
	registry.Register(&fake.Engine{EngineID: contracts.EngineIdClaudeCode, APIKey: store.Provider(contracts.EngineIdClaudeCode),
		Models: []contracts.EngineCapabilitiesModelsElem{{Id: "claude-opus-5-5", Label: "Opus 5.5"}}})
	registry.Register(&fake.Engine{EngineID: contracts.EngineIdCodex, APIKey: store.Provider(contracts.EngineIdCodex),
		Models: []contracts.EngineCapabilitiesModelsElem{{Id: "gpt-5.5", Label: "GPT-5.5"}, {Id: "gpt-5.5-pro", Label: "GPT-5.5 Pro"}}})
	reporter := &accounts.Reporter{Engines: &registry, Send: func(_ context.Context, m contracts.RunnerCapabilities) error {
		h.sent = append(h.sent, m)
		return nil
	}}
	h.cli = &accountsCLI{
		in:         strings.NewReader(input),
		out:        h.out,
		readSecret: func() (string, error) { return secret, nil },
		store:      store,
		claude:     "claude",
		interactive: func(_ context.Context, name string, args ...string) error {
			h.ran = append(h.ran, append([]string{name}, args...))
			return nil
		},
		refresh: func(ctx context.Context) ([]contracts.EngineCapabilities, error) {
			if !h.running {
				return nil, accounts.ErrNoRunner
			}
			return reporter.Report(ctx)
		},
		local: reporter.Capabilities,
	}
	return h
}

func (h *accountsHarness) last(t *testing.T, id contracts.EngineId) contracts.EngineCapabilities {
	t.Helper()
	if len(h.sent) == 0 {
		t.Fatal("no capabilities sent")
	}
	for _, c := range h.sent[len(h.sent)-1].Engines {
		if c.Engine == id {
			return c
		}
	}
	t.Fatalf("no %s in the last capabilities", id)
	return contracts.EngineCapabilities{}
}

func TestLoginCodexStoresTheKeyAndTheNextCapabilitiesSayItsModelsAreUsable(t *testing.T) {
	keychain := memoryKeyring{}
	h := newAccountsHarness(t, keychain, "", "sk-proj-test-key")

	if err := h.cli.login(context.Background(), "codex"); err != nil {
		t.Fatal(err)
	}

	if keychain["crewdeck-runner/codex"] != "sk-proj-test-key" {
		t.Fatalf("keychain %v", keychain)
	}
	codex := h.last(t, contracts.EngineIdCodex)
	if codex.Account.Kind != contracts.EngineCapabilitiesAccountKindApiKey || codex.Account.State != contracts.EngineCapabilitiesAccountStateConnected {
		t.Fatalf("account %+v, want connected · api-key", codex.Account)
	}
	for _, m := range codex.Models {
		if !m.Usable {
			t.Fatalf("model %+v not usable", m)
		}
	}
	out := h.out.String()
	for _, want := range []string{"Clé API de Codex enregistrée sur cette machine", "Modèles utilisables de Codex : GPT-5.5 (gpt-5.5), GPT-5.5 Pro (gpt-5.5-pro)"} {
		if !strings.Contains(out, want) {
			t.Errorf("output %q lacks %q", out, want)
		}
	}
}

func TestNoMessageOfTheRunnerHoldsTheKey(t *testing.T) {
	h := newAccountsHarness(t, memoryKeyring{}, "", "sk-proj-never-sent")
	if err := h.cli.login(context.Background(), "codex"); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(h.sent)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "sk-proj-never-sent") || strings.Contains(h.out.String(), "sk-proj-never-sent") {
		t.Fatalf("the key left the store: %s", data)
	}
}

func TestWithoutAKeychainLoginWritesAFileOfModeSixHundred(t *testing.T) {
	h := newAccountsHarness(t, noKeyring{}, "", "sk-proj-file")
	if err := h.cli.login(context.Background(), "codex"); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(h.cli.store.Dir, "codex.key"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("key file %v, %v: want mode 600", info, err)
	}
	if h.last(t, contracts.EngineIdCodex).Account.State != contracts.EngineCapabilitiesAccountStateConnected {
		t.Fatal("codex not connected with its key in a file")
	}
}

func TestLoginClaudeOffersTheSubscriptionAndTheApiKey(t *testing.T) {
	t.Run("the subscription runs claude with /login", func(t *testing.T) {
		keychain := memoryKeyring{"crewdeck-runner/claude-code": "sk-ant-old"}
		h := newAccountsHarness(t, keychain, "1\n", "")
		if err := h.cli.login(context.Background(), "claude"); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(h.out.String(), "Abonnement Claude ou clé API ?") {
			t.Fatalf("output %q lacks the question", h.out.String())
		}
		if len(h.ran) != 1 || strings.Join(h.ran[0], " ") != "claude /login" {
			t.Fatalf("ran %v, want claude /login", h.ran)
		}
		if _, ok := keychain["crewdeck-runner/claude-code"]; ok {
			t.Fatal("the old API key would win over the subscription")
		}
		if len(h.sent) != 1 {
			t.Fatalf("sent %d capabilities after the sign-in, want 1", len(h.sent))
		}
	})
	t.Run("the API key is read hidden and stored", func(t *testing.T) {
		keychain := memoryKeyring{}
		h := newAccountsHarness(t, keychain, "2\n", "sk-ant-test")
		if err := h.cli.login(context.Background(), "claude"); err != nil {
			t.Fatal(err)
		}
		if keychain["crewdeck-runner/claude-code"] != "sk-ant-test" || len(h.ran) != 0 {
			t.Fatalf("keychain %v, ran %v", keychain, h.ran)
		}
		if h.last(t, contracts.EngineIdClaudeCode).Account.Kind != contracts.EngineCapabilitiesAccountKindApiKey {
			t.Fatal("claude not on its API key")
		}
	})
	t.Run("another answer is asked again", func(t *testing.T) {
		h := newAccountsHarness(t, memoryKeyring{}, "3\n1\n", "")
		if err := h.cli.login(context.Background(), "claude"); err != nil {
			t.Fatal(err)
		}
		if len(h.ran) != 1 {
			t.Fatalf("ran %v", h.ran)
		}
	})
}

func TestLoginWithoutARunningRunnerSaysItSendsAtItsNextConnection(t *testing.T) {
	h := newAccountsHarness(t, memoryKeyring{}, "", "sk-proj-test")
	h.running = false
	if err := h.cli.login(context.Background(), "codex"); err != nil {
		t.Fatal(err)
	}
	out := h.out.String()
	if !strings.Contains(out, "Le Runner ne tourne pas") || !strings.Contains(out, "Modèles utilisables de Codex : GPT-5.5") {
		t.Fatalf("output %q", out)
	}
}

func TestAnEmptyKeyOrAnUnknownMoteurIsRefusedInFrench(t *testing.T) {
	h := newAccountsHarness(t, memoryKeyring{}, "", "  ")
	if err := h.cli.login(context.Background(), "codex"); err == nil || !strings.Contains(err.Error(), "Aucune clé API saisie") {
		t.Fatalf("empty key: %v", err)
	}
	if err := h.cli.login(context.Background(), "gemini"); err == nil || !strings.Contains(err.Error(), "claude ou codex") {
		t.Fatalf("unknown Moteur: %v", err)
	}
}

func TestLogoutDeletesTheKeyAndSaysHowToLeaveASubscription(t *testing.T) {
	keychain := memoryKeyring{"crewdeck-runner/claude-code": "sk-ant-test"}
	h := newAccountsHarness(t, keychain, "", "")
	if err := h.cli.logout(context.Background(), "claude"); err != nil {
		t.Fatal(err)
	}
	if len(keychain) != 0 {
		t.Fatalf("keychain %v", keychain)
	}
	out := h.out.String()
	if !strings.Contains(out, "Clé API de Claude Code supprimée") || !strings.Contains(out, "/logout") {
		t.Fatalf("output %q", out)
	}
	if h.last(t, contracts.EngineIdClaudeCode).Account.State != contracts.EngineCapabilitiesAccountStateLoginRequired {
		t.Fatal("claude still connected after its logout")
	}

	h.out.Reset()
	if err := h.cli.logout(context.Background(), "codex"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(h.out.String(), "Aucune clé API de Codex") {
		t.Fatalf("output %q", h.out.String())
	}
}

func TestTheLoginCommandRunsAFakeClaudeForTheSubscription(t *testing.T) {
	dir := t.TempDir()
	record := filepath.Join(dir, "args")
	binary := filepath.Join(dir, "claude")
	script := "#!/bin/sh\necho \"$@\" > " + record + "\n"
	if err := os.WriteFile(binary, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := runInteractive(context.Background(), binary, "/login"); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(record)
	if strings.TrimSpace(string(got)) != "/login" {
		t.Fatalf("claude ran with %q", got)
	}
}
