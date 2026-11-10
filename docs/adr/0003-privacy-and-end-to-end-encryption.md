# Nothing the Pilote writes freely is readable by Crewdeck

> **Status:** accepted, 2026-11-10.

## Context

The PRD promises that conversations, code and diffs travel encrypted end to
end between the **Runner** and the **Pilote**'s browser, the servers keeping
only the state of the **Process** (US-60), and that a **Session** shows only
its title and state while the Runner is offline. The founder added, during
the design, that an **Idée** is often more confidential than code (a
client, a strategy, an unannounced product): storing them readable would be
badly received. Push notifications need a title; the Process's state must be
readable by the server to orchestrate.

## Decision

### What the server reads, and what it never reads

| Readable by the server | Encrypted end to end (ciphertext only, never stored except where said) |
|---|---|
| Identifiers, states, dates, durations, figures (impact, effort, costs, usage, counts) | The text of an **Idée**, its analysis, the reasons of a merge or a rejection (stored, ciphertext) |
| Titles already on GitHub: **Tickets**, PRs, **Conceptions** (their PR) | A **Session**'s messages, tool calls, questions, permission requests and their answers (relayed, never stored) |
| The kind and short label of a **Décision** (« Ticket bloqué · #42 Connexion GitHub ») | Local diffs and logs of the Runner (relayed, never stored) |
| The verdict of a **Contrat** check (passed, the list of what is missing by its rule ids) | Anything a Pilote types to an agent |

- The server stores no ciphertext of a Session: a Session's content exists
  on the Runner, which replays it to a browser that opens it. Runner
  offline: title and state only (US-60).
- An **Idée**'s ciphertext is stored (it is the Idée). Its notifications and
  « À toi » lines are generic (« 3 Idées à trier »); search and duplicates
  run in the browser and on the Runner.
- The captures of a visual review are pushed by the Runner to the
  **Projet**'s repository (orphan branch `captures/<ticket>`, as
  personal-os) and read by the browser from GitHub
  ([ADR 0002](0002-github-app.md)).

### Keys

- **Key holders**: the Runner and each **Appareil** (a browser the Pilote
  trusts) have an X25519 key pair. An Appareil's private key is a
  non-extractable WebCrypto key kept in IndexedDB; the Runner's is a file
  of mode 600 in its state folder.
- **The vault key**: one random AES-256 key per Pilote, known only to the
  key holders. Every stored ciphertext (an Idée) is AES-256-GCM under a
  per-item key wrapped by the vault key; a Session's key is random, wrapped
  for each key holder, its messages AES-256-GCM with the Session id and the
  message's `seq` as additional data.
- **Wrapping** for a key holder follows HPKE's base mode (RFC 9180):
  X25519, HKDF-SHA256, AES-256-GCM, one ephemeral key per wrap. WebCrypto
  in the browser, Go's standard library on the Runner; shared test vectors
  in `packages/contracts/fixtures/crypto/` prove both sides agree. No
  third-party crypto library.
- **The first Appareil** is the browser that shows the install command
  (US-2). Its link code (`7KQ4-M2PX`, Crockford base32) is two halves: the
  first identifies the link for the server; the second is a secret the
  browser drew and never sends. Runner and browser exchange their public
  keys through the server and each proves it knows the secret with an
  HMAC-SHA256 over both keys: a server that swapped a key cannot forge it.
  A code is valid 10 min and burns at the first proof, right or wrong (one
  guess of 20 bits). The browser then creates the vault key and wraps it for
  the Runner.
- **A new Appareil** (the phone) shows a code of the same shape (or a QR);
  the Pilote types it on an Appareil already trusted, the same proof runs,
  and the trusted Appareil wraps the vault key for the new one. Without any
  trusted Appareil: `crewdeck-runner appareils approuver <code>` on the
  Runner.
- **Revoking an Appareil** (Paramètres) rotates the vault key: the next
  Appareil or Runner online rewraps the item keys under the new one; the
  server stops serving ciphertext to the revoked one at once.
- **Losing every key holder** (Runner reinstalled and no Appareil left)
  loses the Idées' text: the product says so before the last revocation.

## Options that lost

- **Idées readable in our database**: simplest, and against the founder's
  point above. **Idées as issues of a private repository of the Pilote**
  stays possible later, as a **Connecteur** of the « Idées et Tickets »
  module (US-88).
- **Trust on first use** (the server hands out the public keys): our own
  server could swap a key and read everything.
- **Storing Sessions' ciphertext for 30 days**: US-60 settled that a Session
  shows only its title and state while the Runner is offline.
- **libsodium**: one dependency on each side for what WebCrypto and Go
  already do.

## Consequences

- The protocol is written in `docs/security/e2e.md` by its first ticket,
  with the test vectors, and reviewed by an outside reviewer before the
  Bêta (risk SEC-3).
- The Idée analysis (Rôle Idée) needs the Runner: an Idée noted while it is
  offline is encrypted by the browser with the vault key and analysed when
  the Runner is back (« en attente du Runner »).
- Server logs never contain a payload of the Runner protocol nor an Idée's
  ciphertext; the logger's redaction list is tested.
