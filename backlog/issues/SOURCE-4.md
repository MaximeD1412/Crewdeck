---
id: SOURCE-4
title: "Reading content in the page for every Source: artifact.read answered encrypted by the Runner through the relay, the document reader's GitHub and Local fetchers"
epic: SOURCE
type: feature
priority: P1
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [SOURCE-2, SESSION-1]
adr: [0012, 0003, 0007]
risques: []
stories: [US-99, US-60]
screens: []
revue_visuelle: false
video: false
---

## Context

US-60: code, diffs and local work never sit readable on someone else's server; an artefact shows only its title and state while the Runner is offline. ADR 0012, « Reading content in the page »: a document to review, a Ticket's body, a local diff or a Commande's output of a Local Projet is read through the encrypted relay, as a Session (ADR 0007): the tab asks `artifact.read { projectId, kind: file | ticket | change | diff | command-output, ref }`, the Runner answers encrypted for that tab, nothing is stored. The document reader of `apps/web` gets this second fetcher beside GitHub's (the user token, ADR 0002), behind the same `@tanstack/query-core` keys. This ticket is the data layer, no screen: PROJET-5 draws the `DocumentReader` Composant on it; BOUCLE-5, BOUCLE-6, CONCEPTION-4 and IDEE-5 read through it.

## Current state of the code

- `apps/web/src/api/`: the API clients; `POST /api/github/token` (`apps/server/src/auth/github-token.controller.ts`) gives the page the Pilote's GitHub user token; `apps/web/package.json` has no `@tanstack/query-core`; no document reader.
- `apps/web/src/keys/`: the Appareil's key pair, the vault (`vault.ts`), `crypto.ts` (`openWrap`, `aesGcmOpen`).
- Created by SESSION-1: the tab frames and the relay (`packages/contracts/src/runner/relay.ts`: `session.keys { wraps: [{ holderId, enc, wrappedKey }] }`, `relay`, `session.error`), `SessionRelay` (`apps/server/src/sessions/relay/`: the tabs per Pilote in memory, never written nor logged, the logger's redaction of `ciphertext`, `wrappedKey`, `enc`, `nonce`), the Runner's `internal/session/relay.go` (a key wrapped for each holder of the authenticated list), `apps/web/src/sessions/relay.ts`.
- Created by SOURCE-2: `apps/runner/internal/source/local/` (`Ticket`, `Comments`, `Change`, `Reviews`), the clone `~/.crewdeck/repos/local/<projectId>`, `State.Projects`.
- Created by RUNNER-9: the clones of a GitHub Projet (`apps/runner/internal/session/clone.go`).

## To do

- **Protocol** `packages/contracts/src/runner/artifact.ts`, fixtures in `packages/contracts/fixtures/runner/artifact/`, `pnpm exec nx run contracts:generate`:
  - tab → server `artifact.read { requestId (UUIDv7), projectId, holderId (the tab's Appareil), kind, ref }`, `ref` by kind: `file { path, at? }` (`at` a branch or SHA, the integration branch by default), `ticket { number }`, `change { number }`, `diff { number } | { base, head }`, `command-output { runId }`;
  - server → Runner the same with `tabId`;
  - Runner → server, server → tab `artifact.content { requestId, tabId, wrap: { holderId, enc, wrappedKey }, nonce, ciphertext }` (a random key wrapped for that holder as a Session key is, the content AES-256-GCM with additional data `artifact:<requestId>`) and `artifact.error { requestId, tabId, code }`, codes `artifact.not-found`, `artifact.too-large`, `artifact.untrusted-device`, `artifact.runner-offline`, `artifact.timeout`;
  - the plaintext, by kind: `file` `{ path, sha, content (UTF-8, or base64 with `binary: true`) }`; `ticket` the Ticket with its comments in `gh issue view --json number,title,body,state,stateReason,labels,milestone,comments,blockedBy,parent`'s shape; `change` the change with its reviews and comments in `gh pr view --json number,title,body,state,headRefName,headRefOid,baseRefName,reviews,comments`'s; `diff` `{ base, head, patch }` (unified); `command-output` `{ chunks: [{ seq, at, stream, text }] }`.
- **Server** `apps/server/src/artifacts/artifact-relay.ts` (beside `SessionRelay`, same rules): `artifact.read` from a tab is forwarded when the Projet is the Pilote's (else `artifact.not-found`), the Runner online (else `artifact.runner-offline`); the pending `requestId → tabId` kept in memory 30 s (then `artifact.timeout`); `artifact.content` and `artifact.error` forwarded to that tab only; nothing written, nothing logged but type, `requestId` and `kind`.
- **Runner** `apps/runner/internal/artifact/`:
  - `read.go`, by kind: `file` → `git show <at>:<path>` in the Projet's clone after a `git fetch origin` when `at` is a branch (a `path` with `..` or absolute is `artifact.not-found`); `ticket`, `change` → SOURCE-2's Reader; `diff` → `git diff <base>...<head>` in the clone (`number`: the change's base and head); `command-output` → `~/.crewdeck/commands/<runId>.log` (absent: `artifact.not-found`). 4 MiB of plaintext at most, else `artifact.too-large`.
  - `seal.go`: the holder must be in the authenticated list of key holders (E2E-2, never the server's word), else `artifact.untrusted-device`; the wrap and the seal as `internal/session/relay.go`'s, through the shared code.
  - Wired in `cmd/crewdeck-runner/run.go` (`artifact.read` handler, one goroutine per request).
- **Web** `apps/web/src/documents/` (adds `@tanstack/query-core` to `apps/web/package.json`):
  - `reader.ts`: `documentQuery({ projectId, source: 'github'|'local', kind, ref })`, the key `['artifact', projectId, kind, ref]`, one `QueryClient` of the page; `source` given by the caller from the Projet's Source of the group (`ticket` for `ticket`, `code` for the others, `command-output` always `local`), so the reader never guesses; results kept in memory only, never in IndexedDB nor localStorage; stale after 30 s, dropped 5 min after its last observer.
  - `github-fetcher.ts`: with the user token, `file` through `GET /repos/{owner}/{repo}/contents/{path}?ref=` (raw), `ticket` through the issue and its comments, `change` through the pull request, its reviews and comments, `diff` with `Accept: application/vnd.github.diff`; mapped to the same plaintext shapes as the Runner's.
  - `local-fetcher.ts`: sends `artifact.read` on the tab's socket, opens `artifact.content` with the Appareil's private key, rejects with the `artifact.error` code.
  - The result `{ state: 'ready', value } | { state: 'unavailable', reason: 'runner-offline'|'not-found'|'too-large'|'untrusted-device'|'timeout' }`: a caller shows the title and state it already has when `unavailable`.
- `docs/security/e2e.md`: the « Contenu lu par la page » section (the frames, the additional data, what the server sees).

## Decisions already made

- Nothing read is stored on the server, not even in memory beyond the 30 s of the pending request (ADR 0012, « Copies of Local content pushed encrypted to the server » lost).
- The answer is sealed for the one Appareil that asked: a key holder of the authenticated list, so that a compromised server asking for a Projet's files gets nothing it can open (risk SEC-4, ADR 0003).
- A GitHub Projet's content is read from GitHub with the user token as before (ADR 0002); the relay is for what lives on the machine. A Commande's output is always the Runner's.
- `file` reads committed content in the Runner's clone, never the Pilote's working tree: a document to review is the one on its branch at its SHA, and the reader never shows a file the Pilote has not committed.
- 4 MiB: a document, a Ticket or a diff of a Ticket; a larger one says so instead of slowing the socket.

## Acceptance criteria

- [ ] `ticket 12` of a Local Projet (a temporary git repository) is answered sealed by the Runner (Go test, fake server) and a recorded answer decrypts in the page (web test); relayed through the server, the database and the logs hold none of it (server test with a marker string).
- [ ] `file docs/prd.md` at a branch and at a SHA answer that version; `../x` answers `artifact.not-found`; a 5 MiB file `artifact.too-large`.
- [ ] `diff { number }` gives the change's patch; `command-output` replays a run's log.
- [ ] An `artifact.read` with a `holderId` not in the Runner's authenticated list answers `artifact.untrusted-device` and seals nothing.
- [ ] Runner offline: `unavailable / runner-offline` at once; a Runner that does not answer within 30 s: `timeout`.
- [ ] Another Pilote's Projet: `artifact.not-found`, nothing sent to the Runner.
- [ ] The GitHub fetcher maps a recorded issue, PR and diff (a `fetch` double, no network) to the same shapes as the Local fetcher; both share the query keys.
- [ ] Every new frame has its fixture, valid in TypeScript and Go; a content sealed in Go opens in TypeScript.

## Verification

- `cd apps/runner && go test ./internal/artifact/ ./internal/session/`
- `pnpm exec nx test contracts -- src/runner/`
- `pnpm exec nx test server -- src/artifacts/`
- `pnpm exec nx test web -- src/documents/`
- `pnpm exec nx run contracts:generate` with no diff, then `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The `DocumentReader` Composant and its screens: PROJET-5. Approving a document: CONCEPTION-4, PROJET-5.
- A Commande's live output: RUNNER-18.
- Sealed titles of the lists: SOURCE-3.

## Dependencies

- SOURCE-2.
- SESSION-1.
