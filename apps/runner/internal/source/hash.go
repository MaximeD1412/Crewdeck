package source

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strconv"
	"strings"

	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
)

// contentHashLabel is the label of the content hash's key, derived from the vault key.
const contentHashLabel = "crewdeck/v1/content-hash"

// ContentHash is a Ticket's content hash for both Sources (ADR 0012, « The
// Source wins »): `v<vault key's version>.` and the base64url HMAC-SHA256,
// under a key derived from the vault key, of the title, a blank line and the
// body, its line endings made `\n` and its trailing whitespace trimmed. The
// server never computes it (it has no key); a hash of another version is
// never compared with one of this version.
func ContentHash(vault *keys.Vault, title, body string) string {
	body = strings.ReplaceAll(body, "\r\n", "\n")
	body = strings.ReplaceAll(body, "\r", "\n")
	body = strings.TrimRight(body, " \t\n")
	mac := hmac.New(sha256.New, vault.DeriveKey(contentHashLabel))
	mac.Write([]byte(title + "\n\n" + body))
	return "v" + strconv.Itoa(vault.Version) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
