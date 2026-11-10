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
ephemeral key. On the wire a wrap is `{ enc, ciphertext }`, both base64url;
`ciphertext` is `len(plaintext) + 16` bytes (48 for a 32-byte key).

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
| The vault key for a holder | `holderId ‖ vaultKeyVersion` | E2E-2 |
| An item | the item's id and field | E2E-2, IDEE-1 |
| A Session key for a holder | the Session id and the holder's id | SESSION-1 |

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

`shortId` enters as its 4 ASCII characters; the public keys as 32 raw bytes
each. The secret is the 16 bytes the code's base32 decodes to.

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
| The wraps `{ enc, ciphertext }` of the vault key, the Session keys | The vault key, an item key, a Session key |
| The items' ciphertext (stored), the Session frames (relayed, not stored), their nonces and lengths | Any plaintext of an Idée, a Session, a diff or a log |
| The ids and numbers bound as additional data | |

The server logs neither a payload of the Runner protocol nor a ciphertext
(ADR 0003, Consequences).

## Threats

| Threat | What stops it |
|---|---|
| The server swaps a public key during a pairing, to receive a wrap | Each side MACs both public keys with the 128-bit secret the server never sees; the server sees the proofs but cannot try 2^128 secrets offline, so it cannot forge a proof for a swapped key; a code works once and for 10 min (E2E-2, E2E-3) |
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
mode, Chromium) and `apps/runner/internal/keys/vectors_test.go`:

| File | What | Written by |
|---|---|---|
| `hpke-rfc9180.json` | RFC 9180's official vector for mode 0, KEM 0x0020, KDF 0x0001, AEAD 0x0002, first encryption (hex, with its `source`). Both sides open its `ct` and reseal it with its `skEm` byte for byte | copied from the RFC's `test-vectors.json` |
| `crewdeck-wrap.json` | HPKE wraps for each `info`, an empty and a long plaintext | the Runner |
| `aes-gcm.json` | AES-256-GCM seals with Session and item additional data | the Runner |
| `hmac.json` | RFC 4231 case 2, a link-proof-shaped message, constant-time comparisons | the Runner |
| `base32.json` | encodings, alias decodings, invalid inputs | the Runner |
| `web-seal.json` | an HPKE wrap and an AES-GCM seal made by the browser, opened by the Runner | the browser, at each test run |

RFC 9180 Appendix A.1.1 is the AES-128-GCM suite (AEAD 0x0001); the vector
for AES-256-GCM comes from the RFC's `test-vectors.json` at the commit named
in the fixture's `source`.

The Runner's files are regenerated with `cd apps/runner && go test
./internal/keys -run TestGenerateVectors -update`; without `-update`, that
test fails if regenerating would change one byte. The browser's file is
rewritten by each run of `crypto.spec.ts` and stays byte-stable.

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

To be written by E2E-2: the link flow, the exact bytes of both proofs and of
the vault wraps (`holderId ‖ vaultKeyVersion`), the item keys under the vault
key.

## New Appareil (E2E-3)

To be written by E2E-3: the QR code `crewdeck:appareil:<shortId>-<secret>`,
the proof, the approval by a trusted Appareil or by the Runner.

## Revocation (E2E-4)

To be written by E2E-4: the rotation of the vault key, the rewrap of the item
keys.

## Sessions (SESSION-1)

To be written by SESSION-1: the frames, the Session keys' wraps, the
additional data, what the server relays.

## Idées (IDEE-1)

To be written by IDEE-1: the sealed fields of an Idée and their additional
data.
