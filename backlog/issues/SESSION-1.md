---
id: SESSION-1
title: "Encrypted relay of a Session between the Runner and the tabs, never stored"
epic: SESSION
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [RUNNER-9, E2E-2]
adr: [0003, 0007, 0004]
risques: [SEC-4, SEC-7]
stories: [US-60]
screens: []
revue_visuelle: false
video: false
---

## Context

US-60: conversations, code and diffs travel encrypted end to end between the Runner and the Pilote's browser; the servers keep only the state of the Process. ADR 0003 sets the Session keys (a random key per Session, wrapped for each key holder, messages AES-256-GCM with the Session id and the message's `seq` as additional data) and ADR 0007 the relay (ciphertext passed from the Runner to the tabs that opened the Session and back, never stored; opening a Session asks the Runner to replay it from its local log). This ticket is the pipe, without any screen: SESSION-2 draws the panel on it, SESSION-3 answers questions and permission requests through it, IDEE-4's dictation and PROJET-5's « Demander des changements » send inputs through it.

## Current state of the code

- Only documents: `docs/adr/0003-privacy-and-end-to-end-encryption.md`, `docs/adr/0007-real-time.md`, `CONTEXT.md` (**Session**, **Appareil**).
- Created by E2E-1: the primitives in `packages/contracts/src/crypto/` (TypeScript, WebCrypto) and `apps/runner/internal/keys/` (Go): HPKE base mode wrap/unwrap, AES-256-GCM seal/open, shared vectors in `packages/contracts/fixtures/crypto/`, `docs/security/e2e.md`.
- Created by E2E-2: the Appareil's key pair in IndexedDB (`apps/web/src/keys/`), the vault key, and the authenticated list of key holders (the Runner and the trusted Appareils) on both sides.
- Created by RUNNER-2: the socket `/api/ws` for tabs (CORE-5) and for the Runner, `RunnerGateway`, `RunnerCommands.send(pilotId, message)`, the protocol schemas in `packages/contracts/src/runner/` and their fixtures, `apps/server/test/fakes/runner.ts`, `apps/server/src/testing/fake-runner.ts`.
- Created by RUNNER-4: the normalised events of a Session (`packages/contracts/src/runner/events.ts`).
- Created by RUNNER-9: `AgentSession` (`apps/server/src/sessions/`), the Runner's Session lifecycle and its local log (`apps/runner/internal/session/`, `~/.crewdeck/sessions/<id>/`).

## To do

- **Protocol** (`packages/contracts/src/runner/relay.ts`, fixtures in `packages/contracts/fixtures/runner/relay/`):
  - tab → server: `session.open { sessionId, fromSeq }`, `session.close { sessionId }`, `session.input { sessionId, inputId (UUIDv7), nonce, ciphertext }`;
  - server → Runner: `session.replay { sessionId, tabId, fromSeq }`, `session.input { sessionId, tabId, inputId, nonce, ciphertext }`;
  - Runner → server: `session.keys { sessionId, tabId?, wraps: [{ holderId, enc, wrappedKey }] }`, `relay { sessionId, tabId?, seq, nonce, ciphertext }` (`tabId` set for a replay to one tab, absent for a live message to every tab that opened the Session);
  - server → tab: the same `session.keys` and `relay` frames, and `session.error { sessionId, code }` with codes `session.not-found`, `session.runner-offline`.
  - Base64url for binary fields. Nothing else readable in a frame: the kind of a message (text, tool call, question…) is inside the ciphertext.
- **Server** `apps/server/src/sessions/relay/`:
  - `SessionRelay`: per Pilote, in memory, the tabs that opened each Session (`Map<sessionId, Set<tabId>>`), cleared when the tab's socket closes.
  - `session.open`: the Session must belong to the tab's Pilote (scope), else `session.error session.not-found`; Runner offline → `session.error session.runner-offline` (the tab keeps the subscription and gets the replay when the Runner says `hello` again); else `session.replay` to the Runner.
  - `relay` and `session.keys` from the Runner: forwarded to `tabId` or to every tab of the Session; never written to the database, never logged.
  - `session.input` from a tab: forwarded to the Runner with the `tabId`; Runner offline → `session.error session.runner-offline`.
  - Add `ciphertext`, `wrappedKey`, `enc`, `nonce` to the logger's redaction list (CORE-1), and log relay frames by type and `sessionId` only.
- **Runner** `apps/runner/internal/session/relay.go`:
  - at a Session's start, a random 32-byte Session key kept in memory and in `~/.crewdeck/sessions/<id>/key` (mode 600), wrapped for each key holder of the authenticated list (E2E-2); a key holder approved later (E2E-3) gets a wrap at its next `session.open` (`session.keys` sent before any `relay`);
  - each normalised event appended to the local log gets the next `seq`; it is sent encrypted (`AES-256-GCM`, additional data `<sessionId>:<seq>`) to the server as a live `relay`;
  - `session.replay`: `session.keys` for the tab's holder, then every logged event with `seq >= fromSeq`, encrypted, with the `tabId`;
  - `session.input`: decrypted with additional data `<sessionId>:input:<inputId>`, validated against the input schema, handed to the Session (`message`, `answer`, `permission`: the schemas live in `packages/contracts/src/runner/inputs.ts`; this ticket handles `message`, SESSION-3 the two others), duplicates of an `inputId` ignored.
- **Browser** `apps/web/src/sessions/`:
  - `relay.ts`: `openSession(sessionId)` returns a subscription that unwraps the key with the Appareil's private key, decrypts each `relay` into a normalised event and feeds `session-buffer.ts`; `sendInput(sessionId, input)` encrypts and sends; `closeSession(sessionId)`.
  - `session-buffer.ts`: the decrypted events per Session, ordered by `seq`, in memory only (no IndexedDB, no localStorage, no store event), dropped on close; a gap in `seq` re-opens with `fromSeq` = the first missing one.
- Write the « Sessions » section of `docs/security/e2e.md`: the frames, the additional data, the holders, what the server sees.

## Decisions already made

- Additional data: `<sessionId>:<seq>` for what the Runner sends, `<sessionId>:input:<inputId>` for what a tab sends; the Runner numbers events, tabs never do.
- The Runner's local log is plaintext normalised events in `~/.crewdeck/sessions/<id>/log.jsonl` (the Runner's own state folder, mode 700): it is the content, it stays on the Pilote's machine; encryption happens on the wire.
- No server storage of any frame, not even in memory beyond forwarding: a tab that opens a Session while the Runner is offline sees title and state only (SESSION-2).
- A Session's content reaches only the tabs that sent `session.open` for it; a Pilote's other tabs get nothing.
- The Session key is wrapped only for holders of the authenticated list kept by E2E-2/E2E-3; the list the server could send is never trusted on its own (SEC-4).

## Acceptance criteria

- [ ] A tab that opens a Session receives `session.keys` then every logged event from `fromSeq`, decrypts them, and then receives the live events.
- [ ] A message written in a tab reaches the Runner's Session decrypted, once even if sent twice with the same `inputId`.
- [ ] A frame whose additional data does not match (another `seq`, another Session) fails to decrypt and is dropped with a console warning, never shown.
- [ ] Opening another Pilote's Session gives `session.error session.not-found`; nothing is asked of the Runner.
- [ ] Runner offline: `session.open` and `session.input` give `session.error session.runner-offline`; when the Runner says `hello`, the open subscriptions get their replay.
- [ ] A test proves no Prisma write happens while frames are relayed, and the logger's output for a relay frame contains no `ciphertext`, `wrappedKey`, `enc` nor `nonce`.
- [ ] The shared fixtures of the relay frames are valid in TypeScript and in Go; a vector encrypted in Go decrypts in TypeScript and back.

## Verification

- `pnpm exec nx test contracts -- src/runner/relay.spec.ts`
- `pnpm exec nx test server -- src/sessions/relay/session-relay.spec.ts`
- `pnpm exec nx test web -- src/sessions/relay.spec.ts`
- `cd apps/runner && go test ./internal/session/ -run TestRelay`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

Nothing.

## Out of scope

- The panel and its states: SESSION-2. Questions and permission requests: SESSION-3. Interrupting the Sessions when the Runner goes offline: SESSION-2.
- Rotating Session keys when an Appareil is revoked: E2E-4.

## Dependencies

- RUNNER-9
- E2E-2
