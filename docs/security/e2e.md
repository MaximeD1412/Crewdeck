# End-to-end encryption

The protocol by which conversations, code, diffs and the text of the Idées
travel between the **Runner** and the **Appareils** without Crewdeck being
able to read them ([ADR 0003](../adr/0003-privacy-and-end-to-end-encryption.md),
US-60). It is written for the outside review before the Bêta (risk SEC-3):
every byte a primitive reads or writes is given here, and each later ticket
fills its own section.

| Side | Code | Library |
|---|---|---|
| Appareil (browser) | `apps/web/src/keys/crypto.ts`, `base32.ts`, `bytes.ts` | WebCrypto only |
| Runner | `apps/runner/internal/keys/` | Go's standard library only (`crypto/ecdh`, `crypto/hkdf`, `crypto/aes`, `crypto/cipher`, `crypto/hmac`, `crypto/subtle`) |
| Both | `packages/contracts/fixtures/crypto/` | the shared test vectors |

No third-party crypto library on either side. The browser needs WebCrypto's
X25519 (Chrome 133+, Safari 17+, Firefox 130+): `supportsEndToEnd()` of
`apps/web/src/keys/support.ts` tries a key pair and a `deriveBits`, and a
browser without them gets no fallback.

## Notation

- `‖` is the concatenation of byte strings; `"text"` is the UTF-8 bytes of
  the text, without a terminator; `u16(n)` is `n` on 2 bytes, big endian;
  `uint32be(n)` on 4 bytes.
- Every byte string carried in JSON (an API body, a protocol message, a
  fixture) is **base64url without padding** (RFC 4648 §5). Decoders are
  strict: an `=`, a character outside the alphabet or a non-canonical last
  character is refused, so each byte string has one spelling. The RFC 9180
  fixture alone keeps the RFC's hex, to be compared with its source.

## Key holders and keys

| Key | What | Where it lives | Who can read it |
|---|---|---|---|
| A key holder's key pair | X25519. The Runner has one, each Appareil has one | Appareil: a non-extractable WebCrypto `CryptoKey` in IndexedDB. Runner: a file of mode 600 in its state folder | Only its holder. The server stores the 32-byte public key |
| The vault key | 32 random bytes (AES-256), one per Pilote, versioned (`vaultKeyVersion`) | Wrapped for each key holder (the HPKE wrap below), the wraps stored by the server | The key holders |
| An item key | 32 random bytes (AES-256), one per stored item (an Idée's text, its analysis, a reason) | Wrapped by the vault key next to the item's ciphertext | The key holders |
| A Session key | 32 random bytes (AES-256), one per Session, drawn by the Runner | Wrapped for each key holder that opens the Session, never stored by the server | The key holders |

All the randomness (key pairs, AES keys, HPKE ephemeral keys, nonces) comes
from `crypto.getRandomValues` / `crypto.subtle.generateKey` in the browser and
`crypto/rand` on the Runner. An Appareil's private key is generated
non-extractable and never leaves WebCrypto; an AES key is extractable only
where it must be wrapped.

The raw public key of a non-extractable private key is computed as
`X25519(sk, 9)` (the base point), as `publicKeyOf()` does.

## The wrap: HPKE base mode

Wrapping a key for a key holder is HPKE (RFC 9180) in base mode (`mode_base
= 0x00`, no PSK, no sender authentication), single shot (one encryption per
context, sequence number 0), with the suite:

| | Id | |
|---|---|---|
| KEM | `0x0020` | DHKEM(X25519, HKDF-SHA256) |
| KDF | `0x0001` | HKDF-SHA256 |
| AEAD | `0x0002` | AES-256-GCM |

`hpkeSeal(pkR, plaintext, info, aad) → { enc, ciphertext }` and
`hpkeOpen(skR, enc, ciphertext, info, aad) → plaintext` (Go: `HPKESeal`,
`HPKEOpen`).

### Labels

```
suite_id_KEM  = "KEM"  ‖ u16(0x0020)                               (5 bytes)
suite_id_HPKE = "HPKE" ‖ u16(0x0020) ‖ u16(0x0001) ‖ u16(0x0002)    (10 bytes)

LabeledExtract(suite, salt, label, ikm) =
    HKDF-Extract(salt, "HPKE-v1" ‖ suite ‖ label ‖ ikm)
LabeledExpand(suite, prk, label, info, L) =
    HKDF-Expand(prk, u16(L) ‖ "HPKE-v1" ‖ suite ‖ label ‖ info, L)
```

An empty salt is HMAC's key of 32 zero bytes (HMAC pads its key with zeros).
WebCrypto's HKDF does Extract then Expand in one `deriveBits`; a
LabeledExtract alone is an HMAC-SHA256 keyed by the salt.

### Seal

```
skE, pkE      = a fresh X25519 key pair, one per seal (never reused)
dh            = X25519(skE, pkR)                       refused if all zeros
enc           = pkE                                    (32 bytes, raw)
kem_context   = enc ‖ pkR                              (64 bytes)
eae_prk       = LabeledExtract(suite_id_KEM, "", "eae_prk", dh)
shared_secret = LabeledExpand(suite_id_KEM, eae_prk, "shared_secret", kem_context, 32)

psk_id_hash   = LabeledExtract(suite_id_HPKE, "", "psk_id_hash", "")
info_hash     = LabeledExtract(suite_id_HPKE, "", "info_hash", info)
context       = 0x00 ‖ psk_id_hash ‖ info_hash         (65 bytes)
secret        = LabeledExtract(suite_id_HPKE, shared_secret, "secret", "")
key           = LabeledExpand(suite_id_HPKE, secret, "key", context, 32)
base_nonce    = LabeledExpand(suite_id_HPKE, secret, "base_nonce", context, 12)

ciphertext    = AES-256-GCM(key, nonce = base_nonce, aad, plaintext)
              = encrypted plaintext ‖ tag (16 bytes)
```

Open recomputes `dh = X25519(skR, enc)` and `pkR = X25519(skR, 9)`, then the
same schedule. The nonce is not sent: it is `base_nonce`, sequence number 0,
and a context serves one encryption only, since each seal has its own
ephemeral key. `ciphertext` is `len(plaintext) + 16` bytes (48 for a 32-byte
key). A holder never installs a key from this bare wrap: base mode does not
authenticate who sealed it, so every wrap between holders is an
[authenticated wrap](#authenticated-wraps).

### `info`, one per use

| `info` | What it wraps | For |
|---|---|---|
| `crewdeck/v1/vault-wrap` | the vault key | each key holder (E2E-2, E2E-3, E2E-4) |
| `crewdeck/v1/item-key` | an item key | an item, when it is wrapped for a holder rather than by the vault key |
| `crewdeck/v1/session-key` | a Session key | each key holder opening the Session (SESSION-1) |

A wrap made for one use never opens as another: `info` enters `info_hash`,
so the key and the nonce differ.

### Additional data

Additional data is always given and never empty: both sides refuse an empty
one on seal and on open (only the RFC's own vector has one, which is not
empty either). It binds the ids the ciphertext belongs to, so the server
cannot move a ciphertext to another holder, item, version or Session. The
exact layout of each use is fixed by the ticket that introduces it:

| Use | Additional data | Ticket |
|---|---|---|
| The vault key for a holder | `"<holderId>:<vaultKeyVersion>"` (`dev_…:1`, `run_…:1`) | E2E-2 |
| An item | the item's id and field | E2E-2, IDEE-1 |
| A Session key for a holder | the Session id and the holder's id | SESSION-1 |

## Authenticated wraps

HPKE's base mode does not authenticate the sender (RFC 9180, §9.1.2): anyone
holding `pkR`, the server included, can seal for it. Binding the public keys
in the pairing proofs is not enough: the server could relay the proofs
untouched, then swap the vault wrap for `hpkeSeal(pkR, a key it chose, info,
aad)`, and the recipient would install a key the server knows. So each wrap
also carries a tag that only its sender and its recipient can compute, from
their static X25519 keys, over the whole wrap and its context:

```
dh      = X25519(skS, pkR) = X25519(skR, pkS)        refused if all zeros
authKey = HKDF-SHA256(salt = "", ikm = dh,
                      info = "crewdeck/v1/wrap-auth" ‖ pkS ‖ pkR, L = 32)
tag     = HMAC-SHA256(authKey, u16(len(info)) ‖ info ‖ u16(len(aad)) ‖ aad ‖ enc ‖ ciphertext)
```

- `pkS` and `pkR` are the sender's and the recipient's 32-byte public keys,
  in that order; a holder wrapping for itself (an Appareil's own vault wrap)
  has `pkS = pkR`. `info` and `aad` are length-prefixed (at most 65535 bytes
  each); `enc` is always 32 bytes, so `ciphertext` is the rest.
- `sealWrap(skS, pkR, plaintext, info, aad) → { enc, ciphertext, tag }` and
  `openWrap(skR, pkS, wrap, info, aad) → plaintext` (Go: `SealWrap`,
  `OpenWrap`). `openWrap` checks the tag in constant time **before**
  opening; a wrong tag is the same `OpenError` / `ErrOpen` as a failed open.
  On the wire a wrap is `{ enc, ciphertext, tag }`, each base64url.
- The server, without `skS` nor `skR`, cannot compute `authKey`: it cannot
  make a tag for a substituted `enc` or `ciphertext`, nor move a tag to
  another `info`, `aad` or recipient. The recipient could forge a wrap "from"
  the sender to itself, which gains it nothing.
- **`pkS` is only ever a key the recipient already authenticated**, never
  one the server hands over with the wrap: the peer's key checked by a
  pairing proof (E2E-2, E2E-3), its own key, or a key a holder it trusts
  vouched for in an authenticated wrap. Each holder keeps these keys locally.

| Wrap | Sender | Recipient | Ticket |
|---|---|---|---|
| The vault key, at the first pairing | the first Appareil | the Runner, and the Appareil itself | E2E-2: the Runner opens it with the `devicePublicKey` the device proof authenticated; the Appareil, at each boot, with its own key |
| The vault key, for a new Appareil | the approving holder | the new Appareil | E2E-3: the new Appareil opens it with the approver's key the approval proof authenticated |
| The vault key of a new version | the rotating holder | each holder kept | E2E-4: only from a holder that was not revoked |
| A Session key | the Runner | each holder opening the Session | SESSION-1: opened with the Runner's key authenticated at pairing |

## AES-256-GCM: items and Session frames

`aesGcmSeal(key, plaintext, aad) → sealed` and `aesGcmOpen(key, sealed,
aad) → plaintext` (Go: `AESGCMSeal`, `AESGCMOpen`):

```
nonce  = 12 random bytes, drawn for each seal
sealed = nonce (12 bytes) ‖ encrypted plaintext ‖ tag (16 bytes)
```

- The key is 32 bytes (AES-256); the tag is 128 bits; the additional data
  is never empty.
- A sealed value shorter than 28 bytes is refused before decrypting.
- With random 96-bit nonces a key seals at most 2^32 messages (NIST SP
  800-38D, §8.3); a Session key or an item key seals far fewer.

| Use | Additional data | Ticket |
|---|---|---|
| A frame the Runner sends | `"<sessionId>:<seq>"` | SESSION-1 |
| An input a tab sends | `"<sessionId>:input:<inputId>"` | SESSION-1 |
| An item key under the vault key | `"crewdeck/v1/item-key" ‖ ` the item's additional data | E2E-2 |
| An item under its item key | the item's id and field | E2E-2, IDEE-1 |

### Errors

A failed open, whatever the cause (a wrong key, a flipped bit in `enc`, the
ciphertext or the tag, other additional data, another `info`), throws one
opaque error: `OpenError` in TypeScript, `ErrOpen` in Go. Nothing tells the
causes apart, and no partial plaintext is returned.

## Pairing proofs: HMAC-SHA256

A key holder proves it knows a link secret with
`hmacSha256(secret, message)` (32 bytes), and the other side checks it
with `constantTimeEqual(a, b)`. The comparison looks at every byte whatever
the first difference; only the length may end it early, and lengths are not
secret. Each message starts with a label naming its direction, then the
short id, then the public keys in a fixed order, so a proof never replays as
another:

| Proof | MACed bytes | Ticket |
|---|---|---|
| The Runner, linking | `"crewdeck/v1/link/runner" ‖ shortId ‖ runnerPublicKey ‖ devicePublicKey` | E2E-2 |
| The first Appareil, linking | `"crewdeck/v1/link/device" ‖ shortId ‖ devicePublicKey ‖ runnerPublicKey` | E2E-2 |
| A new Appareil | `"crewdeck/v1/device/new" ‖ publicKey` | E2E-3 |
| Its approver | `"crewdeck/v1/device/approve" ‖ newPublicKey ‖ approverPublicKey` | E2E-3 |

`shortId` enters as its 4 ASCII characters; the public keys as 32 raw bytes
each. The secret is the 16 bytes the code's base32 decodes to.

The proofs authenticate the public keys only; what is wrapped after them is
authenticated by the [wrap's tag](#authenticated-wraps), computed with those
keys. A holder verifies the proof first, then opens the wrap with the key the
proof authenticated.

## Code formats: Crockford base32

`encodeBase32(bytes)` / `decodeBase32(text)` (Go: `EncodeBase32`,
`DecodeBase32`), alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, 5 bits per
character, most significant bit first:

- written in upper case, without padding nor hyphens;
- read in either case, with Crockford's aliases `I`, `i`, `L`, `l` → `1` and
  `O`, `o` → `0`;
- refused: `U`, a hyphen, `=`, a space, any other character (no Unicode case
  folding: `ß`, `ﬀ` are refused), a length whose remainder by 8 is 1, 3 or 6,
  and a last character whose unused low bits are not zero. So a code has one
  spelling up to case and aliases.

A 128-bit secret is 26 characters. A link code is `<shortId>-<secret>`: the
4-character short id the server knows (`7KQ4`), a hyphen the parser splits
on, and the 26-character secret the server never receives. The code is
copied or scanned, never typed (ADR 0003).

## What the server sees

| The server sees | It never sees |
|---|---|
| The key holders' public keys, the short ids, the proofs | A link secret, a private key |
| The wraps `{ enc, ciphertext, tag }` of the vault key, the Session keys | The vault key, an item key, a Session key |
| The items' ciphertext (stored), the Session frames (relayed, not stored), their nonces and lengths | Any plaintext of an Idée, a Session, a diff or a log |
| The ids and numbers bound as additional data | |

The server logs neither a payload of the Runner protocol nor a ciphertext
(ADR 0003, Consequences).

## Threats

| Threat | What stops it |
|---|---|
| The server swaps a public key during a pairing, to receive a wrap | Each side MACs both public keys with the 128-bit secret the server never sees; the server sees the proofs but cannot try 2^128 secrets offline, so it cannot forge a proof for a swapped key; a code works once and for 10 min (E2E-2, E2E-3) |
| The server relays the proofs untouched but swaps a wrap for one of a key it chose | The [wrap's tag](#authenticated-wraps), keyed by the static X25519 secret of sender and recipient, covers `enc`, `ciphertext`, `info` and `aad`; the recipient checks it with a sender key it authenticated before opening |
| The server replays one direction's proof as the other's | The labels differ (`…/link/runner`, `…/link/device`) and the keys are in opposite orders |
| The server moves a ciphertext to another item, holder, version or Session | The additional data binds those ids; the open fails |
| The server replays or reorders Session frames | The frame's `seq` is in its additional data, so a frame does not open at another position; a tab drops a frame whose `seq` it already has, and reopens from the first missing one on a gap (SESSION-1) |
| The server reuses a wrap for another use | `info` differs per use |
| Tampering with a ciphertext, a tag or `enc` | AES-GCM's tag; one opaque error |
| A reused nonce | A fresh ephemeral key per HPKE seal; a random 96-bit nonce per AES-GCM seal |
| A low-order X25519 point | The all-zero shared secret is refused (RFC 9180, §7.1.4), on both sides |
| A test seam reaching production | The deterministic randomness lives in `testing.ts`, imported by no production module; `apps/web/src/production-build.spec.ts` builds the keys' modules in production mode and asserts the seam is absent |

Out of this protocol: a compromised Appareil or Runner (it holds the keys),
the server serving a page that steals keys (the code the browser runs comes
from Crewdeck), and traffic analysis (sizes, timings, ids stay visible).

## Test vectors

`packages/contracts/fixtures/crypto/`, read by
`apps/web/src/keys/crypto.spec.ts` and `base32.spec.ts` (Vitest browser
mode, Chromium), `pairing.spec.ts` and `vault.spec.ts`, and
`apps/runner/internal/keys/vectors_test.go` and `pairing_test.go`:

| File | What | Written by |
|---|---|---|
| `hpke-rfc9180.json` | RFC 9180's official vector for mode 0, KEM 0x0020, KDF 0x0001, AEAD 0x0002, first encryption (hex, with its `source`). Both sides open its `ct` and reseal it with its `skEm` byte for byte | copied from the RFC's `test-vectors.json` |
| `crewdeck-wrap.json` | Authenticated wraps (sender, recipient, `enc`, `ciphertext`, `tag`) for each `info`, an empty and a long plaintext, a holder's wrap for itself | the Runner |
| `aes-gcm.json` | AES-256-GCM seals with Session and item additional data | the Runner |
| `hmac.json` | RFC 4231 case 2, a link-proof-shaped message, constant-time comparisons | the Runner |
| `base32.json` | encodings, alias decodings, invalid inputs | the Runner |
| `web-seal.json` | an authenticated wrap and an AES-GCM seal made by the browser, opened by the Runner | the browser, at each test run |
| `link-pairing.json` | link pairings: both key pairs, the secret, the short id, both proofs, the vault key and its two wraps of version 1 | the Runner |
| `item.json` | an Appareil's vault wrap and items sealed under the vault key (item key, ciphertext) | the Runner |
| `web-pairing.json` | the page's side of a first link (its proof, its two vault wraps) and an item it sealed, opened by the Runner | the browser, at each run of `pairing.spec.ts` |

RFC 9180 Appendix A.1.1 is the AES-128-GCM suite (AEAD 0x0001); the vector
for AES-256-GCM comes from the RFC's `test-vectors.json` at the commit named
in the fixture's `source`.

The Runner's files are regenerated with `cd apps/runner && go test
./internal/keys -run TestGenerateVectors -update`; without `-update`, that
test fails if regenerating would change one byte. The browser's files are
rewritten by each run of `crypto.spec.ts` and `pairing.spec.ts` and stay
byte-stable.

### The deterministic stream

Each Crewdeck vector has a `seed`. In tests, every random value is drawn
from one stream, the same on both sides:

```
block(i) = HMAC-SHA256(seed, "crewdeck/test/random" ‖ uint32be(i)),  i = 0, 1, …
stream   = block(0) ‖ block(1) ‖ …
```

Each draw takes the next bytes: an X25519 private key 32, an AES key 32, an
AES-GCM nonce 12. So the browser reseals the Runner's vectors byte for byte,
and the Runner the browser's. The RFC's vector uses a fixed stream holding
its `skEm` alone. The seam is `withDeterministicRandom(seed, run)` /
`withFixedRandom(bytes, run)` in `apps/web/src/keys/testing.ts`, and the
package variable `random` in `apps/runner/internal/keys/keys.go`, replaced by
the `_test.go` files only.

## First Appareil (E2E-2)

The first link of a Pilote's account: the page « Premiers pas » and
`crewdeck-runner link` exchange their public keys through the server, prove
them to each other with the code's secret, and the page draws the vault key
and wraps it for both. A later link from a trusted Appareil wraps the
existing key for the new Runner.

### Keys and where they live

| Holder | Key pair | Its vault wrap |
|---|---|---|
| The Appareil | X25519, generated non-extractable at the first code the page draws, kept in IndexedDB (`crewdeck-keys`, store `device`, record `self`) with the `deviceId` the server gave it (`apps/web/src/keys/device-store.ts`) | fetched at each boot, `GET /api/devices/:id/vault-key-wrap` |
| The Runner | X25519, generated by `crewdeck-runner link`, saved as `runner.key` (the 32-byte private key in base64url, mode 600) | saved as `vault.wrap` (mode 600) with the `devicePublicKey` that sealed it, sent again in `hello.accepted` |

Every request of the page carries its Appareil's id in `X-Crewdeck-Device`
once it has one; the server names that Appareil `current` in the snapshot.

### The flow

```
page                               server                              Runner
 │ POST /api/runner/link-codes
 │  { pairing: { devicePublicKey,
 │               deviceName } } ──▶ a pending Appareil, the code
 │ ◀── { id, shortId, expiresAt, deviceId }
 │ shows `crewdeck-runner link --link <shortId>-<secret>` (the secret stays in the page)
 │                                    ◀── POST /api/runner/link { shortId, machine… }
 │                                    ──▶ { linkId, browserPairing }
 │                                    ◀── POST /api/runner/link/:linkId/pairing
 │                                         { pairing: { runnerPublicKey, proof_R } }
 │ ◀── runner-link.upserted { state: pending, runnerId, runnerPairing }
 │ checks proof_R; on a mismatch:
 │ POST …/:id/reject { reason: pairing-mismatch } ──▶ the code fails; the page draws a new one
 │ else POST …/:id/confirm { pairing: { proof_D, vaultKeyVersion,
 │                                      runnerVaultWrap, deviceVaultWrap? } }
 │                          ──▶ in one transaction: the Appareil trusted, the Runner,
 │                              the wraps, device.upserted, runner.upserted, runner-link.upserted
 │                                    ◀── GET /api/runner/link/:linkId
 │                                    ──▶ { state: linked, runnerId, token, pairing:
 │                                          { proof_D, vaultKeyVersion, runnerVaultWrap } }
 │                                         checks proof_D, opens its wrap, then writes
 │                                         runner.key, vault.wrap, runner.json
 │ GET /api/devices/:deviceId/vault-key-wrap ──▶ opens its own wrap: the vault unlocked
```

`runnerId` is drawn by the server when the code becomes pending, so the page
can bind it in the Runner's wrap before the Runner exists.

### The exact bytes

With `secret` the 16 bytes the code's 26 base32 characters decode to,
`shortId` its 4 ASCII characters, and the public keys raw (32 bytes each):

```
proof_R = HMAC-SHA256(secret, "crewdeck/v1/link/runner" ‖ shortId ‖ runnerPublicKey ‖ devicePublicKey)
proof_D = HMAC-SHA256(secret, "crewdeck/v1/link/device" ‖ shortId ‖ devicePublicKey ‖ runnerPublicKey)

vaultKey        = 32 random bytes                         (the first link; version 1)
runnerVaultWrap = sealWrap(skDevice, runnerPublicKey, vaultKey,
                           "crewdeck/v1/vault-wrap", "<runnerId>:<vaultKeyVersion>")
deviceVaultWrap = sealWrap(skDevice, devicePublicKey, vaultKey,
                           "crewdeck/v1/vault-wrap", "<deviceId>:<vaultKeyVersion>")
```

The additional data is the UTF-8 of the holder's id, a colon and the version
in decimal (`run_01J9ZQ5R:1`). The page compares `proof_R` in constant time
and returns no pairing on a mismatch; it zeroes its copy of the vault key and
of the secret once the wraps are made. The Runner compares `proof_D` in
constant time, then opens its wrap with the `devicePublicKey` the proof
authenticated (`openWrap(skRunner, devicePublicKey, …)`); a wrong proof, a
wrap that does not open, or a vault key that is not 32 bytes all give the
same refusal, and the Runner writes nothing.

At each start, `crewdeck-runner run` opens its vault again from `runner.key`
and `vault.wrap` alone (`openVault`, `cmd/crewdeck-runner/vault.go`), the
same check as the link's; a Runner whose files are missing or whose wrap no
longer opens refuses to run and says to link it again. The page opens its own
wrap once its code is linked: on the confirmation's answer, or on the event
that shows it linked when that answer was lost.

### Items under the vault key

An item (an Idée's text, a reason: IDEE-1 fixes their additional data) is
sealed under its own key, and that key under the vault key:

```
itemKey    = 32 random bytes, one per item
key        = aesGcmSeal(vaultKey, itemKey, "crewdeck/v1/item-key" ‖ aad)   (12 + 32 + 16 bytes)
ciphertext = aesGcmSeal(itemKey, plaintext, aad)
```

`aad` is never empty; the label keeps a sealed item key from opening as an
item. Both sides: `sealItem` / `openItem` (`apps/web/src/keys/vault.ts`),
`Vault.SealItem` / `Vault.OpenItem` (`apps/runner/internal/keys/vault.go`).

### Relinking from a trusted Appareil

A Pilote whose vault exists links another Runner from an Appareil the server
has as trusted: the page opens the vault, wraps the same key at the current
version for the new Runner only (`deviceVaultWrap` absent), and the version
does not change. The server refuses a confirmation from an Appareil that is
not trusted (422 `devices.not-trusted`), a first link without
`deviceVaultWrap` or with a version other than 1, and a relink at another
version or with `deviceVaultWrap` (422 `runner.link-pairing-invalid`).

### The vault's states in the page

| `vaultState` | When |
|---|---|
| `unlocked` | the Appareil's wrap opened |
| `locked` | before it opens, or the server could not give it, or it did not open (a wrong tag, another version) |
| `no-device` | no Appareil in this browser, or the server forgot or revoked it (`devices.not-found`, `devices.revoked`): another browser signing in later; E2E-3 approves it |

### What proves it

| What | Test |
|---|---|
| Both proofs and wraps, byte for byte, on both sides | `link-pairing.json` read by `pairing.spec.ts`; `web-pairing.json` written by `pairing.spec.ts`, opened by `TestWhatTheBrowserPairedOpens` |
| The same vault key on both sides | an item sealed by the Runner opened in the browser (`vault.spec.ts`, `item.json`), one sealed by the browser opened in Go (`web-pairing.json`) |
| A full link: the real `crewdeck-runner link` against the server, the web's pairing and vault code on the page's side, the Runner restarted, an item each way | `test/integration/first-appareil.spec.ts` (with `TestVaultProbe`) |
| The Runner opens its vault at start, or refuses to run | `cmd/crewdeck-runner/vault_test.go` |
| A swapped device key refused by the Runner, a swapped Runner key by the page | `cmd/crewdeck-runner/link_test.go`; `pairing.spec.ts`; `e2e/demarrage.spec.ts` |
| A wrap substituted under untouched proofs refused | `cmd/crewdeck-runner/link_test.go` |
| The secret and the vault key in no request nor column | `test/integration/first-appareil.spec.ts`; `test/integration/runner-link.spec.ts`; `e2e/demarrage.spec.ts` |

## New Appareil (E2E-3)

A browser signed in to the account but holding no vault key (`vaultState`
`no-device`: a phone, another profile) draws its own key pair and a 128-bit
secret, and shows them as a code. An Appareil already trusted, or the Runner
from its machine, checks the code against what the server relays and wraps
the vault key for the new public key. No short code is ever typed: a secret
short enough to type could be ground offline by the server.

### The code

```
code = <shortId> "-" <secret>            7K2Q-ABCDEFGHJKMNPQRSTVWXYZ0120
QR   = "crewdeck:appareil:" <code>
```

`shortId` is 4 Crockford characters the server draws, unique among the
Pilote's live codes, so the approver can ask for the pending Appareil; the
secret is 16 random bytes in 26 Crockford characters (the last one carries 2
zero padding bits), drawn by the new page and never sent. A code lives 10
minutes (`DEVICE_CODE_TTL_SECONDS`); a Pilote has at most 3 live codes
(`PENDING_DEVICES_MAX`, 422 `devices.too-many-pending`). Both readers
(`parseDeviceCode`, `apps/web/src/keys/approval.ts` and
`cmd/crewdeck-runner/devices.go`) take the QR's text or the code alone, in any
case, with spaces, and refuse a secret whose padding bits are not zero.

### The flow

```
new page                            server                       approver (a trusted page, or the Runner)
 │ draws skN (kept while it has no id) and secret
 │ POST /api/devices
 │  { publicKey: pkN, name, proof_N } ──▶ a pending Appareil, its code live 10 min
 │ ◀── { id, shortId, expiresAt }
 │ shows the QR and the code ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶ scanned or pasted
 │                                    ◀── GET /api/devices/pending/:shortId
 │                                        (the Runner: GET /api/runner/devices/pending/:shortId)
 │                                    ──▶ { id, shortId, name, publicKey: pkN, proof_N, expiresAt }
 │                                         checks proof_N; on a mismatch, approves nothing
 │                                         asks « Approuver « name » ? »
 │                                    ◀── POST /api/devices/:id/approve
 │                                        (the Runner: POST /api/runner/devices/:id/approve)
 │                                         { approver: { type, id }, vaultKeyVersion, wrap, proof_A }
 │                          in one transaction: the Appareil trusted, its wrap, the
 │                          approver's public key and proof_A kept, device.upserted
 │ ◀── device.upserted { state: trusted }
 │ GET /api/devices/:id/approval ──▶ { approver: { type, id, publicKey: pkA }, proof_A }
 │ checks proof_A over pkN ‖ pkA; then keeps its id and pkA
 │ GET /api/devices/:id/vault-key-wrap ──▶ opens it from pkA: the vault unlocked
```

The server takes `pkA` from what it already holds, never from the body: the
trusted Appareil that sends the request (its `X-Crewdeck-Device`, 422
`devices.not-trusted` otherwise), or the Runner of the Bearer token (its key
from its link). It refuses a code expired or already used (409
`devices.not-pending`), and a version other than the Pilote's current one
(422 `devices.approval-invalid`).

### The exact bytes

With `secret` the 16 bytes of the code, `pkN` the new Appareil's public key
and `pkA` the approver's (the trusted Appareil's, or the Runner's), raw (32
bytes each):

```
proof_N = HMAC-SHA256(secret, "crewdeck/v1/device/new" ‖ pkN)
proof_A = HMAC-SHA256(secret, "crewdeck/v1/device/approve" ‖ pkN ‖ pkA)

wrap    = sealWrap(skA, pkN, vaultKey,
                   "crewdeck/v1/vault-wrap", "<newDeviceId>:<vaultKeyVersion>")
```

The approver compares `proof_N` in constant time before it asks the Pilote
anything: a server that relays another public key cannot compute it without
the secret, and nothing is wrapped. The new page compares `proof_A` in
constant time and keeps nothing on a mismatch: a server that names another
approver key cannot compute it either. The new page then opens its wrap from
the `pkA` the proof authenticated (`openWrap(skN, pkA, …)`, the stored
`senderPublicKey`), so a wrap the server sealed itself does not open.

Vectors (in `approval.spec.ts` and `internal/keys/device_test.go`), with
`secret = 00 01 … 0f`, `pkN = 11 × 32`, `pkA = 22 × 32`, in base64url:

```
proof_N = NULG3lc4ksC0AGvvSApBzn65aDVMCw9mpjhkRngplZE
proof_A = txJX8MrtUMCD9-qgPpWAKf61I4PBvdBhEq27LOMt5mE
```

### What proves it

| What | Test |
|---|---|
| Both proofs, byte for byte, on both sides | the vectors above, in `approval.spec.ts` and `TestNewDeviceProofsMatchTheirVectors` |
| A trusted Appareil approves a new one: the new vault opens an item the trusted one sealed | `apps/web/src/keys/approval.spec.ts` |
| A swapped `pkN` approves nothing; a swapped `pkA` or a wrong `proof_A` opens nothing | `approval.spec.ts`; `TestTheRunnerApprovesNothingWhenTheServerSwapsTheKey` |
| The real `crewdeck-runner appareils approuver` approves a second browser, which opens what the first one sealed | `test/integration/devices-runner.spec.ts` |
| The routes: their schemas, 401, another Pilote's Appareil, 409, 422 | `test/integration/devices-approval.spec.ts` |
| The secret in no request | `approval.spec.ts`; `devices-runner.spec.ts` |

## Revocation (E2E-4)

To be written by E2E-4: the rotation of the vault key, the rewrap of the item
keys. The wraps of the new version are [authenticated wraps](#authenticated-wraps);
a holder refuses one whose sender it knows as revoked.

## Sessions (SESSION-1)

To be written by SESSION-1: the frames, the Session keys' wraps, the
additional data, what the server relays. A Session key's wrap is an
[authenticated wrap](#authenticated-wraps) from the Runner, opened with the
Runner's public key the Appareil authenticated at pairing, never one the
server sends with the wrap: otherwise the server could hand a tab a Session
key it knows and read what the Pilote types.

## Idées (IDEE-1)

To be written by IDEE-1: the sealed fields of an Idée and their additional
data.
