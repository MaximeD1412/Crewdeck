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
| `crewdeck/v1/device-holder` | a new Appareil's public key | the Runner, from the Appareil's approver (E2E-3) |

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
| A Session key for a holder | `"<sessionId>:<holderId>"`, `holderId` the base64url of the holder's public key | SESSION-1 |
| A new Appareil's key for the Runner | the new Appareil's id | E2E-3 |

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
| A new Appareil's public key | the approving holder | the Runner (the Runner approving seals it to itself) | E2E-3: the Runner opens it with a key it already holds, so the server can hide an Appareil from it, never add one |
| A Session key | the Runner | each Appareil the Runner authenticated | SESSION-1: opened with the Runner's key the page kept once the Runner's pairing proof verified, or handed on by its approver with `proof_R` (E2E-3) |

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
| Its approver, handing on the Runner's key | `"crewdeck/v1/device/runner" ‖ newPublicKey ‖ runnerPublicKey` | E2E-3 |

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
| The wraps `{ enc, ciphertext, tag }` of the vault key, the Session keys, the new Appareils' keys for the Runner | The vault key, an item key, a Session key |
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
| The server adds a key of its own among the Runner's Session holders | The Runner holds an Appareil only from a wrap that opens from a key it already holds (the first Appareil, its own) and yields the listed key, under the listed id (E2E-3); the server can hide one, not add one |
| The server hands a new Appareil another Runner key | `proof_R` MACs it with the code's secret; the new page keeps nothing on a mismatch (E2E-3) |
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
| `relay.json` | a Session's keys and frames as the tab receives them (the Runner's and the Appareil's keys, the Session key, the events) and an input sealed for it | the Runner |
| `web-relay.json` | an input the page sealed under `relay.json`'s Session key, handed to the Moteur by the Runner | the browser, at each run of `sessions/relay.spec.ts` |

RFC 9180 Appendix A.1.1 is the AES-128-GCM suite (AEAD 0x0001); the vector
for AES-256-GCM comes from the RFC's `test-vectors.json` at the commit named
in the fixture's `source`.

The Runner's files are regenerated with `cd apps/runner && go test
./internal/keys -run TestGenerateVectors -update`; without `-update`, that
test fails if regenerating would change one byte. The browser's files are
rewritten by each run of `crypto.spec.ts`, `pairing.spec.ts` and
`sessions/relay.spec.ts` and stay byte-stable.

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
 │                                         { approver: { type, id }, vaultKeyVersion, wrap, proof_A,
 │                                           runner?: { publicKey: pkR, proof_R }, holder? }
 │                          in one transaction: the Appareil trusted, its wrap, the
 │                          approver's public key and proof_A kept, device.upserted
 │ ◀── device.upserted { state: trusted }
 │ GET /api/devices/:id/approval ──▶ { approver: { type, id, publicKey: pkA }, proof_A, runner? }
 │ checks proof_A over pkN ‖ pkA (and proof_R over pkN ‖ pkR); then keeps its id, pkA and pkR
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

# for the Sessions, from an approver that holds the Runner's key pkR
proof_R = HMAC-SHA256(secret, "crewdeck/v1/device/runner" ‖ pkN ‖ pkR)
holder  = sealWrap(skA, pkR, pkN, "crewdeck/v1/device-holder", "<newDeviceId>")
```

**For the Sessions.** The new page reads the Sessions with the Runner's key
(`runnerPublicKey`): when the Runner approves, it is `pkA` itself; when a
trusted Appareil approves, that Appareil hands on the `pkR` it holds (from its
pairing, or from its own approval) with `proof_R`, which the new page checks
in constant time before keeping anything. The Runner learns `pkN` from
`holder`, a wrap the approver seals to it (the Runner approving seals it to
itself); the server keeps it with the Appareil and lists it on `GET
/api/runner/devices/holders`. The server refuses (422
`devices.approval-invalid`) a `runner` from the Runner approving, a `runner`
without `holder`, and a `holder` without `runner` from an Appareil. An
approver without the Runner's key (paired before SESSION-1) sends neither:
the new vault opens, its Sessions do not.

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
| The Runner's key handed on with `proof_R`: the new Appareil opens a Session's keys and frames; a swapped key keeps nothing | `approval.spec.ts` |
| The Runner holds an Appareil only from a `holder` wrap that opens from a key it holds, in any order, read again at each wrap | `holders_test.go`; `devices-runner.spec.ts` (the holders listed after both approvals) |
| The routes: their schemas, 401, another Pilote's Appareil, 409, 422 | `test/integration/devices-approval.spec.ts` |
| The secret in no request | `approval.spec.ts`; `devices-runner.spec.ts` |

## Revocation and rotation (E2E-4)

Revoking a key holder cuts it off at once, through the server; the vault
key's rotation, done by the first trusted holder online, makes what is sealed
afterwards unreadable to it even if it kept the old key.

### Revoking

- **An Appareil**, from « Paramètres », « Appareils », « Retirer » (the
  product's dialog `crewdeck-confirm`, not an Action sensible): `POST
  /api/devices/:id/revoke { seq }`. In one transaction the Appareil becomes
  `revoked` (`revokedAt`), its wraps of every version are deleted, and, when
  it was trusted, `pilots.vault_rotation_pending` is set; `device.upserted`
  and `vault.upserted { version, rotationPending }` go with it. A pending
  Appareil (a code not approved yet) is revoked the same way, its code dead,
  without a rotation: it held no wrap. Revoking an Appareil already revoked
  changes nothing. The current Appareil may revoke itself: its page then
  clears `crewdeck-keys` and shows the banner of a browser without an
  Appareil (E2E-3).
- **A Runner** that a new link replaced (RUNNER-3): the same transaction that
  revokes it deletes its wraps and sets the rotation pending.
- **At once**: every route refuses a request whose `X-Crewdeck-Device`
  names a revoked Appareil, 422 `devices.revoked` (`NotRevokedDeviceGuard`,
  global: `/api/state`, the Idées, a Process's sealed text, the wrap, the
  vault's routes…). A tab's socket names its Appareil (`/api/ws?device=<id>`):
  the revocation closes it with 4403 once committed, and a new socket naming
  a revoked Appareil is closed with 4403 before any event or replay. The
  header and the parameter are the page's own word: they stop an honest page
  at once, and the rotation is what protects against a page that keeps the
  old key.
- **The page forgets it**, wherever it was revoked from: on a 422
  `devices.revoked` (the call is then made once more without the header), on
  the socket's 4403 (a socket without it is opened at once), and on its own
  `device.upserted` `revoked`. Every tab of the browser does the same, each
  on its own next call or socket. Forgetting is final: the vault key is
  dropped at once, and an unlock asked before, whose wrap arrives after,
  publishes neither the key nor a state.
- **Lock order**: every writer of an Appareil's row (its revocation, its
  approval, its `lastSeenAt`) locks the Pilote's row first, then the
  Appareil's, so that two of them at once wait for each other instead of
  deadlocking. `lastSeenAt` is read first without a lock, since most calls
  change nothing.
- The page asks before the last trusted Appareil: « C'est ton dernier
  Appareil de confiance : si tu réinstalles ensuite le Runner, le texte de tes
  Idées sera perdu. »; `crewdeck-runner uninstall` prints the same warning
  when the Pilote has no trusted Appareil left (risk OPS-1). The request
  says whether the dialog warned (`last`); the server, the Pilote's row
  locked, answers 409 `devices.last-changed` when the Appareil is the last
  trusted one by then without it (two dialogs opened at once), and the page
  asks again with the warning.

### Who rotates

The **holders** are the trusted Appareils and the current Runner (`GET
/api/vault`, `GET /api/runner/vault`: `{ version, rotationPending, holders:
[{ type, id, publicKey }], seq }`). A holder rotates when it sees
`rotationPending`: a trusted, unlocked page through the `vault` slice of its
state, the Runner through `hello.accepted { rotationPending }` or
`vault.rotation-pending` while it is connected. The first one wins; the
others get 409 and see the rotation done. Until it happens the old version
keeps working for every holder kept.

**A holder only seals the new key for public keys it authenticated itself**,
never for the server's list as such: a server that slipped its own key into
`holders` would otherwise receive the new vault key. The rotating holder
checks that every listed holder's key is one it holds, else it does not
rotate and leaves it to another holder:

| Rotating holder | The public keys it holds |
|---|---|
| An Appareil | its own, its approver's (`senderPublicKey`), the Runner's (`runnerPublicKey`, from its pairing or handed on with `proof_R`) |
| The Runner | its own, the first Appareil's (`vault.wrap`), and every Appareil an approval vouched for (`GET /api/runner/devices/holders`, [E2E-3](#new-appareil-e2e-3)) |

So the Runner can rotate for every Appareil, and an Appareil rotates when the
holders kept are itself and the Runner (a laptop and a phone, one revoked);
with more Appareils, the Runner rotates. An Appareil holds its approver's key
only to open the wraps that approver sealed, not to rotate for it. The server can hide a
holder (it then refuses the rotation, below) but never add one.

A revoked approver's attestation still vouches for the Appareils it approved
while trusted: the server lists the revoked Appareils that had a holder wrap
apart, as `vouchers` of `GET /api/runner/devices/holders`, and the Runner
authenticates them the same way to verify the next links of the chain, for
authentication only. A voucher is never a holder: the Runner seals neither a
vault key nor a Session's key for it.

What the revocation cannot stop: a server that keeps listing a revoked
Appareil as trusted gets it the new key, as it could keep serving it the old
items. Revocation trusts the server to stop serving the revoked holder; what
the server alone cannot do is add a key of its own.

### The rotation

```
newVaultKey = 32 random bytes                     version v + 1
for each holder h (type, id, pk):
  wrap_h    = sealWrap(skRotator, pk, newVaultKey,
                       "crewdeck/v1/vault-wrap", "<id>:<v + 1>")
for each item key (itemType, itemId, aad, wrappedKey) of GET /api/vault/items:
  itemKey   = aesGcmOpen(vaultKey_v, wrappedKey, "crewdeck/v1/item-key" ‖ aad)
  rewrapped = aesGcmSeal(newVaultKey, itemKey, "crewdeck/v1/item-key" ‖ aad)
  item      = { itemType, itemId, previousKey: wrappedKey, wrappedKey: rewrapped }
POST /api/vault/rotations (the Runner: /api/runner/vault/rotations)
  { fromVersion: v, toVersion: v + 1, wraps, items, seq }
```

- The item's ciphertext does not change: only its key is rewrapped, under the
  same additional data. The server gives each item's `aad` with its key; a
  wrong one only keeps the key from opening, and the rotator then stops.
- `GET /api/vault/items?cursor=` reads the items page by page (500 at most)
  from `VaultItemsRegistry`, where each kind of stored item registers how it
  lists its keys and replaces one: `idea.text`, `idea.analysis`,
  `idea.reason` (`"<ideaId>:<field>"`), `process-version.sealed` and
  `process-draft.sealed` (`"process:<projectId>"`), `project-settings.worktree-commands`
  (`"settings:<projectId>"`). A ticket that stores a new kind of item
  registers it.
- The server takes the rotation in one transaction, or nothing: 409
  `vault.version-changed` when `fromVersion` is no longer the current one,
  409 `realtime.stale` when the vault changed since `seq`, 422
  `vault.holders-missing` unless `wraps` names every holder exactly once and
  no other, 422 `vault.items-missing` unless `items` is every registered item.
  It then stores the wraps of `v + 1`, deletes those of older versions,
  replaces each item key, moves the version and clears the rotation, with
  `vault.upserted`. The body is bounded at 10 MB (an item takes at most
  about 320 bytes, so 30,000 items at most).
- Each item key is replaced only while the stored one is still its
  `previousKey`, the key the rotator read and unwrapped: a conditional
  UPDATE on the whole sealed item, which PostgreSQL evaluates again on the
  row a concurrent write left. An item sealed again between `GET
  /api/vault/items` and the rotation (a new item key under `v`) would
  otherwise be overwritten by the rewrap of its older key, and its new
  ciphertext would never open: 409 `vault.items-changed`, nothing changes.
- A page whose rotation gets 409 or one of these 422 reloads the vault and
  tries once more; the Runner does the same.
- Every sealed write carries the version of the vault key it sealed under
  (`vaultKeyVersion`: `POST /api/ideas` for the Idée's text, `PATCH
  /api/projects/:id/settings` with the worktree Commandes). The server
  checks it against `pilots.vault_key_version` in the write's transaction,
  after it updated the Pilote's row, the row a rotation holds while it moves
  the version: 409 `vault.version-changed` for an older one (or any other),
  and nothing is stored. The page then unlocks the vault again, seals again
  under the new key and sends once more, once. A version the page opened that
  way, before its `vault.upserted`, makes it read the state again, as its own
  reopening does: the items it holds were rewrapped under the new key. A later writer of a sealed
  item (the process versions and drafts, an Idée's analysis or reason, the
  Local Sources' texts) does the same, else an item sealed under a key no
  holder keeps any more is stored and never opens.
- The Runner's wrap of the new version reaches it in `vault.rotated`
  while it is connected, else in its next `hello.accepted`; it opens it from
  the key of the holder that rotated (one it holds), keeps it as
  `vault.wrap` with that sender's key, and opens its Commandes with the new
  key from then on.
- Each page opens its wrap of the new version at its next unlock (on
  `vault.upserted` with a new version), from the first of its held keys
  whose tag checks: its own, its approver's, the Runner's.
- The Session keys are per Session and are not under the vault key: nothing
  to rewrap (SESSION-1 wraps them for the trusted holders only).

### What proves it

| What | Test |
|---|---|
| A revoked Appareil's next wrap request is 422 `devices.revoked`, the rotation pending, its events | `test/integration/devices-revoke.spec.ts` |
| A trusted Appareil rotates: the version moves, every holder opens the new key, an item sealed before opens after | `apps/web/src/keys/rotation.spec.ts`; `test/integration/devices-revoke.spec.ts` |
| A holder never seals for a key it did not authenticate | `rotation.spec.ts`; `internal/keys/rotation_test.go` |
| The real Runner rotates when it is the first holder online | `test/integration/vault-rotation-runner.spec.ts` |
| A rotation missing a holder or an item, or racing another | `test/integration/devices-revoke.spec.ts` |
| An item sealed again since the rotator read it: 409 `vault.items-changed`, nothing changes; the page and the Runner read again and try once more | `test/integration/devices-revoke.spec.ts`; `apps/web/src/keys/rotation.spec.ts`; `cmd/crewdeck-runner/rotation_test.go` |
| A sealed write under an older vault key: 409 `vault.version-changed`, nothing stored; the page seals again and sends once more | `test/integration/ideas.spec.ts`; `test/integration/project-settings.spec.ts`; `apps/web/src/note-idea.spec.ts`; `apps/web/src/project-settings.spec.ts` |
| Every route and the socket refuse a revoked Appareil; the page forgets it (422, 4403, its event) | `test/integration/devices-revoke.spec.ts`; `apps/web/src/api/client.spec.ts`; `apps/web/src/store/connection.spec.ts`; `apps/web/src/keys/follow.spec.ts` |
| A version opened by a sealed write reads the state again; an unlock answered after the Appareil was forgotten publishes nothing | `apps/web/src/keys/follow.spec.ts`; `apps/web/src/keys/vault.spec.ts`; `apps/web/src/keys/index.spec.ts` |
| A revocation at once with the Appareil's approval or its `lastSeenAt`: no deadlock | `test/integration/devices-revoke.spec.ts` |
| Two dialogs at once cannot revoke the last trusted Appareil without the warning | `test/integration/devices-revoke.spec.ts`; `apps/web/src/app.devices-revoke.spec.ts` |
| The warning before the last trusted Appareil; the current one revoked clears its keys | `apps/web/src/views/devices.spec.ts`; `apps/web/src/app.devices-revoke.spec.ts`; `e2e/devices.spec.ts` |
| A Runner replaced by a new link loses its wraps, the rotation pending | `test/integration/devices-revoke.spec.ts`; `test/integration/runner-link.spec.ts` |
| `crewdeck-runner uninstall` warns when no trusted Appareil is left | `cmd/crewdeck-runner/maintenance_test.go` |

## Sessions (SESSION-1)

What the agent and the Pilote say in a Session travels between the Runner
and the tabs sealed under the Session's key. The server forwards the frames
by their ids and `seq`, and keeps none of them: not in the database, not in
its logs, not in memory once forwarded.

### The Session key and its holders

- A 32-byte AES-256-GCM key, drawn by the Runner when the Session first
  runs, kept in its memory and in `sessions/<id>/key` of its folder (mode
  600), the same after a restart.
- Its holders are the Appareils the Runner authenticated: the Appareil of
  `vault.wrap` (the one the link's device proof authenticated, E2E-2), and
  each Appareil approved later (E2E-3) whose `holder` wrap, listed by `GET
  /api/runner/devices/holders`, opens from a key the Runner already holds
  (that first Appareil, its own, or one held this way) and yields the listed
  key under the listed id; at most 64. The list is read again and checked at
  each wrap, so a new Appareil gets its wrap at its next open, after a
  restart too; a server that does not answer leaves the first Appareil alone
  (a `session.holders` warning in the log).
- `session.keys` carries one [authenticated wrap](#authenticated-wraps) per
  holder, from the Runner: `{ holderId, enc, wrappedKey, tag }`, with
  `holderId` the base64url of the holder's X25519 public key, `info`
  `crewdeck/v1/session-key` and the additional data
  `"<sessionId>:<holderId>"`. At most 64 wraps.
- The Appareil finds its own wrap by its public key and opens it with the
  **Runner's public key it authenticated at pairing**: the page keeps it in
  its Appareil's IndexedDB record once the Runner's proof verifies
  (`confirmPairing`), never a key the server sends. An Appareil approved
  later keeps the one its approver handed on with `proof_R` (E2E-3, « New
  Appareil »). An Appareil without one (paired before SESSION-1, or approved
  by such an Appareil) drops the keys with a console warning. The page keeps the Session key as a
  non-extractable `CryptoKey`, in memory only.

### The frames

| Message | From → to | Sealed | Additional data |
|---|---|---|---|
| `session.open { sessionId, fromSeq }` | tab → server | | |
| `session.replay { sessionId, tabId, fromSeq }` | server → Runner | | |
| `session.keys { sessionId, tabId?, wraps }` | Runner → server → tab | each wrap | `"<sessionId>:<holderId>"` |
| `relay { sessionId, tabId?, seq, nonce, ciphertext }` | Runner → server → tab | the event of the log at `seq`, its JSON without `raw` | `"<sessionId>:<seq>"` |
| `session.input { sessionId, inputId, nonce, ciphertext }` | tab → server → Runner (with the tab's `tabId`) | the Pilote's input (`zSessionInputPayload`) | `"<sessionId>:input:<inputId>"` |
| `session.close { sessionId }` | tab → server | | |
| `session.error { sessionId, code }` | server → tab | | |

- `nonce` is the 12 bytes of the [seal](#aes-256-gcm-items-and-session-frames),
  `ciphertext` the rest (ciphertext and tag), both base64url. A frame holds at
  most 16 MiB, an input 256 KiB: the page refuses an input whose ciphertext
  would exceed it, before sending it (the server closes a socket that sends
  one).
- A frame with a `tabId` is the replay of that tab only; without one, it is
  live, for every tab that opened the Session. The tab never sees a `tabId`.
- The tab opens a frame under its own `seq`, checks the event against its
  schema and that it holds that `seq`; one that does not open, another
  Session's or another `seq`'s, is dropped with a console warning, never
  shown. It drops a `seq` it has, and opens the Session again from the first
  missing one on a gap, once per missing `seq`, and on each socket opened
  again. A Session closed while its keys or a frame are being opened keeps
  nothing of them.
- The Runner opens an input under its `inputId`, checks it against its
  schema, and hands it to the Moteur once per `inputId` (the last 10 000 of
  each Session, kept in `sessions/<id>/inputs` across a restart of the
  Runner): a tab sending it again, after a lost socket, is harmless.
- The server checks a `session.open` and a `session.input` against the
  Pilote's Sessions (`session.not-found`, and nothing for the Runner), and
  answers `session.runner-offline` while the Runner is away; once its
  `hello` is accepted, each open Session is replayed from the first `seq` the
  tab was not sent with every one before it: a live frame that came during a
  replay does not skip the `seq` still missing below it (the tab drops the
  duplicates).

### What the server sees of a Session

The ids (`sessionId`, `tabId`, `inputId`, `holderId`), `seq`, `fromSeq`,
the lengths, the times, and the wraps' and frames' bytes it cannot open. It
logs a frame by its `type` and `sessionId` only; `ciphertext`, `wrappedKey`, `wraps`,
`enc` and `nonce` are redacted from every log line. It never sees the
Session key nor anything said in a Session.

### What proves it

| What | Test |
|---|---|
| The Runner seals the keys and every event, replays from `fromSeq`, hands an input to the Moteur once | `apps/runner/internal/session/relay_test.go` (`TestRelay…`) |
| A vector sealed in Go opens in the browser, one sealed in the browser opens in Go | `relay.json` (written by `TestGenerateVectors`) read by `apps/web/src/sessions/relay.spec.ts`; `web-relay.json` written by it, opened by `TestRelayHandsTheMoteurAnInputTheBrowserSealed` |
| A frame under another `seq` or Session dropped, never shown; keys that do not open dropped | `apps/web/src/sessions/relay.spec.ts` |
| The page keeps the Runner's key its proof authenticated, none of a refused pairing | `apps/web/src/keys/pairing.spec.ts` |
| The server relays to the tab that opened the Session only, refuses another Pilote's, replays at the Runner's hello | `apps/server/src/sessions/relay/session-relay.spec.ts`; `test/integration/session-relay.spec.ts` |
| No database write while frames are relayed, no ciphertext in the logs | `test/integration/session-relay.spec.ts`; `apps/server/src/logging/redact.spec.ts` |
| The frames' fixtures valid in TypeScript and in Go | `packages/contracts/src/runner/relay.spec.ts`; `apps/runner/internal/protocol/fixtures_test.go` |

## Commandes (RUNNER-18)

A Commande's text runs on the Pilote's machine; a compromised server must
not be able to make it run anything else (risk SEC-11, ADR 0013). Its output
travels to the tabs as a Session's does.

### What runs

- `command.run { runId, projectId, commandId, sealed, origin, integrationBranch, ref }`
  names a run; `sealed` is the version's sealed part as the page sealed it,
  an [item under the vault key](#items-under-the-vault-key) with the
  additional data `"process:<projectId>"`, whose plaintext is
  `zSealedCommands` (`{ commands: { <commandId>: { run, where, healthUrl? } } }`).
- The Runner opens it with its vault, under **the message's own**
  `projectId`, and runs only the `run` of the message's `commandId`, in the
  place its `where` says: a part sealed for another Projet does not open, a
  `commandId` it does not hold opens nothing. The whole plaintext is checked
  against `zSealedCommands`, every Commande of it (a `run` of 1 to 10 000
  characters, a `where` of the two, an http(s) `healthUrl`, no other
  property), not only the one asked. The Runner accepts no `healthUrl` zod
  refuses, and refuses a few odd ones zod accepts (a user in it, a host
  that is not ASCII); `fixtures/process-sealed/health-urls.json` of
  `packages/contracts` holds the cases both sides test. Any failure ends the run
  `sealed-invalid` and runs nothing. The message's `ref` (Étape, Ticket,
  branch, sha) chooses which worktree or which commit, never what runs.
- The run is `$SHELL -lc '<run>'` (`/bin/sh` when `SHELL` is unset) as the
  Pilote, in its own process group, one at a time per Projet and Commande,
  killed (SIGTERM, then SIGKILL 10 s later) after 30 minutes or on
  `command.stop`. The verdict, `command.verdict { runId, passed, exitCode,
  reason, durationMs }`, carries figures only.

### The run's key and its output

- A 32-byte AES-256-GCM key per run, drawn by the Runner when it starts,
  kept in `commands/<runId>.key` of its folder (mode 600) for the replays,
  and removed with the run's log after 30 days.
- `command.keys` carries one [authenticated wrap](#authenticated-wraps) per
  holder, as `session.keys` does: `info` `crewdeck/v1/session-key`, the
  additional data `"command:<runId>:<holderId>"` (`commandWrapAad`), which a
  Session's wraps never use.
- Each chunk is the JSON of `zCommandOutputChunk` (`{ stream, text, at }`:
  what one read gave, a line ended or not, at most 16 KiB cut at a
  character's start, a character a read cut in two held for the next),
  sealed under the run's key with the additional data
  `"command:<runId>:<seq>"` (`commandOutputAad`). The Runner logs the
  plaintext chunks in `commands/<runId>.log` (mode 600, its folder 700), and
  replays from it.

| Message | From → to | Sealed | Additional data |
|---|---|---|---|
| `command.open { runId, fromSeq }` | tab → server | | |
| `command.replay { runId, tabId, fromSeq }` | server → Runner | | |
| `command.keys { runId, tabId?, wraps }` | Runner → server → tab | each wrap | `"command:<runId>:<holderId>"` |
| `command.output { runId, tabId?, seq, nonce, ciphertext }` | Runner → server → tab | the chunk at `seq` | `"command:<runId>:<seq>"` |
| `command.close { runId }` | tab → server | | |
| `command.error { runId, code }` | server → tab | | |

The rules of [the Session's frames](#the-frames) hold to the letter: a
frame with a `tabId` is that tab's replay, one without is live; the tab
drops a chunk that does not open under its own run and `seq` with a console
warning naming its ids, opens the run again from the first missing `seq` on
a gap and on each socket opened again; the server refuses the open of a run
that is not the Pilote's (`command.not-found`, `COMMAND_RUN_OWNERS`),
answers `command.runner-offline` while the Runner is away and asks the
replay once its `hello` is accepted.

### What the server sees of a Commande

The ids (`runId`, `projectId`, `commandId`, `tabId`, `holderId`), the
Ticket's ref, `seq`, the verdict's figures, the lengths and the times; the
sealed part and the frames' bytes it cannot open. It never sees a
Commande's text nor its output, writes no frame, and logs one by its `type`
and `runId` only.

### What proves it

| What | Test |
|---|---|
| A sealed part opens only for its Projet and its `commandId`; what fails to open runs nothing | `apps/runner/internal/command/command_test.go` (`TestASealedPartThatDoesNotOpenForThisRunRunsNothing`) |
| The run gets its exit code, its place, its 30 min, its stop | `command_test.go`, `output_test.go` |
| The output logged privately, sealed for the Appareils live and on replay | `output_test.go` (`TestTheOutputIsLoggedPrivatelyAndReplaysFromASeq`, `TestTheOutputIsRelayedSealedForTheAppareilsLiveAndOnReplay`) |
| A chunk under another run or `seq`, keys under another context or Runner, dropped and never shown | `apps/web/src/commands/output.spec.ts` |
| The server relays to the tab that opened the run only, refuses another Pilote's, replays at the hello; no write, no ciphertext in the logs | `apps/server/src/commands/relay/command-output-relay.spec.ts`; `apps/server/test/integration/command-runs.spec.ts` |
| The messages' fixtures valid in TypeScript and in Go | `packages/contracts/src/runner/command.spec.ts`; `apps/runner/internal/protocol/fixtures_test.go` |

## Idées (IDEE-1)

An Idée's free text is three [items under the vault key](#items-under-the-vault-key),
each bound to its Idée and its field:

| Field | Sealed by | Additional data |
|---|---|---|
| `text` | the page, when the Pilote notes it (IDEE-1) | `"<ideaId>:text"` |
| `analysis` | the Runner, after the agent's analysis (IDEE-2) | `"<ideaId>:analysis"` |
| `reason` | the page, a rejection's or a merge's reason (IDEE-3) | `"<ideaId>:reason"` |

`ideaItemAad(ideaId, field)` (`packages/contracts/src/api/ideas.ts`) gives
them on every side. The server cannot move a text to another Idée nor to
another field: it would no longer open.

To seal the text before the Idée exists, the page draws its id (a UUIDv7)
and sends it with the item to `POST /api/ideas`. An id already taken is a 409
`idea.id-taken`: the server never lets a new text replace another Idée's.
The plaintext is trimmed and refused empty before sealing. It stays in the
page's memory only, never in its storage. The server stores and sends `{ key,
ciphertext }` as received, and checks only their lengths (29 to
`12 + 500 × 4 + 16` bytes for `text`). The logger masks `text`, `analysis` and
`reason` (SEC-7).

An Appareil whose vault is not open (`vaultState` other than `unlocked`)
cannot seal: the dialog says « Approuve cet Appareil pour noter une Idée »
and links to « Paramètres ». Its rows read « Déchiffrement… », or « Illisible
sur cet Appareil » when an item does not open.

The scenarios of the end-to-end tests (`idees`, `idees-vide`) seal their
Idées in Node with a test-only vault (`apps/server/src/testing/vault.ts`,
checked against `item.json`). They draw a trusted Appareil's key at each run
and hand it to the test's browser only (`ScenarioRun.device`), never in a
committed file.

| What | Test |
|---|---|
| The page seals the text under `"<id>:text"`, and the request carries no plaintext | `apps/web/src/note-idea.spec.ts`; `e2e/idees.spec.ts` |
| Only ciphertext in the stored row, an id taken refused | `test/integration/ideas.spec.ts` |
| No `text`, `analysis` nor `reason` in the logs | `apps/server/src/logging/redact.spec.ts` |
| The scenarios' vault matches the page's and the Runner's | `apps/server/src/testing/vault.spec.ts`; `test/integration/testing.spec.ts` |
