---
id: MIROIR-4
title: "The Miroir follows GitHub: the server's envelopes applied in order, the token renewed, the 15-min reconciliation, and each Projet's freshness"
epic: MIROIR
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [MIROIR-1, MIROIR-2, MIROIR-3]
adr: [0010, 0004, 0007]
risques: [AGT-7, SEC-6]
stories: [US-20]
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0010, « How it follows GitHub » and « Freshness »: the running Runner keeps its **Miroir** live from the server's envelopes (MIROIR-1): it sends its cursor in its `hello`, applies each `github.changed` by fetching the object it names (MIROIR-3), moves its cursor in the same transaction, holds a **Projet**'s later envelopes behind a failed fetch with a backoff, reconciles at start, after a `mirror.resync` and every 15 min, and renews its « Miroir » token (MIROIR-2). Each Projet's copy is « en remplissage », « live » or « en retard »; MIROIR-6 reads that state to decide whether a read goes to GitHub first (risk AGT-7).

## Current state of the code

- `apps/runner/internal/protocol/client.go`: `Client` (`Config` with `Machine`, `OnAccepted`, `OnConnected`), `Handle(type, handler)`, `Send`; `NewHello(machine)` builds the `hello` of each connection; `messages.go`, `backoff.go`.
- `apps/runner/cmd/crewdeck-runner/run.go`: `machine.run` opens the state and the vault, builds the client, registers the handlers, runs it until a signal.
- `apps/runner/internal/contracts/`: the Go types generated from `packages/contracts` (`runner-hello.go`…).
- Created by MIROIR-1: `hello.mirrorAfter`, `github.changed { change }`, `mirror.resync`, `mirror.live { seq }`, `mirror.projects`; by MIROIR-2: `mirror.token`, `mirror.token.issued`, `mirror.token.failed`; by MIROIR-3: `internal/mirror/` (`Store`, `FetchObject`, `FetchChecks`, `FetchCollections`, `Reconcile`, `LimitedError`, `ErrRefused`, `ErrUnavailable`, `ErrGone`, the `meta.mirror_after` cursor), `internal/github/githubtest/`.

## To do

- `apps/runner/internal/mirror/follower.go`, `Follower` (started by `run.go` with the Store and the protocol client):
  - `hello`: `NewHello` takes the cursor (`Store.Cursor()`, null when none): the `hello` of each connection carries `mirrorAfter`.
  - `mirror.projects` → `Store.PutProjects`, then `mirror.token`; a new Projet starts unfilled and gets its reconciliation.
  - Tokens: `mirror.token` after each accepted `hello` and each `mirror.projects`; `mirror.token.issued` keeps the tokens in memory only (per repository, by installation); renewal 10 min before the earliest `expiresAt` while connected; `mirror.token.failed`, or no answer within 30 s, retried with the backoff below. A `TokenSource` per repository for MIROIR-3's fetches.
  - `github.changed`: queued per Projet, in `seq` order; applying one: `issue`, `pull` → `FetchObject` (and `FetchChecks` of its head for a `pull`), `check` → `FetchChecks(sha)` then the checks of every PR of the copy whose head or merge commit is `sha`, `push` → nothing here (MIROIR-5 reindexes on its integration branch), `label`, `milestone`, `release` → `FetchCollections`; then, in one transaction, the rows and `meta.mirror_after = seq`. The cursor never passes an envelope not applied: with several Projets, it is the lowest `seq` not yet applied minus one, the later applied `seq`s being recorded in `meta` until it catches up (so a restart replays only what is missing; reapplying an envelope is harmless).
  - A failed fetch (`LimitedError`: wait until `RetryAt`; `ErrUnavailable`, `ErrRefused`: backoff 1 s doubling to 5 min) holds that Projet's later envelopes; the other Projets go on. `ErrGone` deletes the object and counts as applied.
  - `mirror.resync`: the reconciliation of every Projet; the `mirror.live { seq }` that follows sets the cursor to `seq` once those reconciliations finished (the live envelopes received meanwhile wait in their queues and are applied after).
  - Reconciliation of every Projet when the Runner starts (once the token arrived), after a `mirror.resync`, and every 15 min (`ReconcileEvery`), one Projet at a time; `MarkSynced` at its end.
- `apps/runner/internal/mirror/freshness.go`: `State(repository) (Freshness, error)`: `filling` while `filled_at` is null; `live` while the socket is connected, `mirror.live` received on this connection and no envelope of the Projet waits; else `late` since `synced_at` (the last envelope applied or reconciliation finished). `Freshness{ State, SyncedAt }`, kept in memory by the follower and written to `projects.synced_at`.
- Logs: one line per envelope applied or failed (`repository`, `kind`, `number`, `seq`, duration, error class), never a title or a body; never a token.

## Decisions already made

- The cursor is moved in the transaction that writes the envelope's rows: a crash between the two is impossible (ADR 0010).
- A Projet's envelopes are applied one after the other, in `seq` order; two Projets in parallel (at most 4 fetches at once for the Runner).
- The backoff and its bounds are the ADR's (1 s doubling to 5 min); a rate limit waits for GitHub's own `RetryAt` instead.
- The tokens live in memory: a restarted Runner asks for new ones.
- The follower is the Miroir's only writer; the commands of MIROIR-6 ask it through the Runner's socket for anything that writes.

## Acceptance criteria

- [ ] A Runner with a cursor of 3 sends `mirrorAfter: 3`; after applying envelopes 4 and 5 its stored cursor is 5 and a restart sends `mirrorAfter: 5` (fake server over `httptest`, fake GitHub).
- [ ] An envelope `issue #12` refetches issue 12 with its relations; `pull #7` the PR and its head's checks; `check <sha>` the checks of the PRs with that head; `label` the labels.
- [ ] A fetch refused with a rate limit holds the Projet's later envelopes until `RetryAt`, while another Projet's envelopes are applied; the cursor never passes the held one.
- [ ] `mirror.resync` reconciles every Projet, then follows live.
- [ ] The token is requested after `hello.accepted` and after `mirror.projects`, renewed 10 min before `expiresAt` (fake clock), and a failure is retried.
- [ ] A Projet's state is `filling` before its first reconciliation, `live` once followed with nothing waiting, `late` with its `syncedAt` after the socket closes or while an envelope waits.
- [ ] The reconciliation runs at start and every 15 min (fake clock), and catches an object whose envelope was lost.
- [ ] The log of these tests contains no token, title nor body.

## Verification

- `cd apps/runner && go test ./internal/mirror/ ./internal/protocol/ ./cmd/crewdeck-runner/`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The documentation index and the `push` to the integration branch: MIROIR-5. The commands and `crewdeck-runner status`: MIROIR-6.

## Dependencies

- MIROIR-1, MIROIR-2, MIROIR-3.
