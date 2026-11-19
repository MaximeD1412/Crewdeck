package source_test

import (
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
)

func vault(t *testing.T, version int) *keys.Vault {
	t.Helper()
	runner, _ := keys.GenerateKeyPair()
	device, _ := keys.GenerateKeyPair()
	vaultKey, _ := keys.GenerateAESKey()
	w, err := keys.SealWrap(device, keys.PublicKeyBytes(runner), vaultKey, []byte(keys.InfoVaultWrap), keys.VaultWrapAAD("run_1", version))
	if err != nil {
		t.Fatal(err)
	}
	v, err := keys.Unlock(runner, keys.PublicKeyBytes(device), "run_1", version, w)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestContentHashIsStableAcrossLineEndingsAndATrailingNewline(t *testing.T) {
	v := vault(t, 3)
	lf := source.ContentHash(v, "Le panier", "Garder les articles.\nAprès un rechargement.")
	for name, body := range map[string]string{
		"CRLF":               "Garder les articles.\r\nAprès un rechargement.",
		"a trailing newline": "Garder les articles.\nAprès un rechargement.\n",
		"trailing spaces":    "Garder les articles.\nAprès un rechargement.  \n\n",
	} {
		if got := source.ContentHash(v, "Le panier", body); got != lf {
			t.Errorf("%s: %s, want %s", name, got, lf)
		}
	}
	if !strings.HasPrefix(lf, "v3.") || strings.ContainsAny(lf[3:], "+/=") || len(lf) != len("v3.")+43 {
		t.Errorf("hash %q, want v3. and base64url of 32 bytes", lf)
	}
}

func TestContentHashDiffersWithTheBodyTheTitleAndTheVaultKey(t *testing.T) {
	v := vault(t, 1)
	base := source.ContentHash(v, "Le panier", "Garder les articles.")
	if source.ContentHash(v, "Le panier", "Garder les articles !") == base {
		t.Error("a changed body gives the same hash")
	}
	if source.ContentHash(v, "Le panier ", "Garder les articles.") == base {
		t.Error("a changed title gives the same hash")
	}
	if source.ContentHash(vault(t, 1), "Le panier", "Garder les articles.") == base {
		t.Error("two vault keys give the same hash")
	}
}

func TestDeriveKeyIsOnePerLabel(t *testing.T) {
	v := vault(t, 1)
	a, b := v.DeriveKey("crewdeck/v1/content-hash"), v.DeriveKey("crewdeck/v1/other")
	if len(a) != 32 || string(a) == string(b) || string(a) != string(v.DeriveKey("crewdeck/v1/content-hash")) {
		t.Errorf("DeriveKey: %x %x", a, b)
	}
}
