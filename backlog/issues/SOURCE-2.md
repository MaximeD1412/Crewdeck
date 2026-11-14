---
id: SOURCE-2
title: "The Local Source on the Runner: its clone with the folder as origin, Ticket files read and written, numbering, local.db, contentHash, Sessions on a Local Projet"
epic: SOURCE
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [RUNNER-9, PROJET-6]
adr: [0012, 0004]
risques: [OPS-10]
stories: [US-99]
screens: []
revue_visuelle: false
video: false
---

## Context

US-99: a Projet with no Connecteur at all, its documents and Tickets being Markdown files of its folder, the product keeping the state of its work while what the work writes stays on the machine. ADR 0012, « The Local folder »: the folder is a git repository; the Runner's clone has it as `origin` (`~/.crewdeck/repos/local/<projectId>`), its worktrees made as for GitHub, never in the Pilote's checkout; a Local Ticket is `tickets/<n>-<slug>.md` with its front matter, milestones in `tickets/milestones.yml`; a file without `number` gets the next one and its name; the Runner writes Tickets in place and never commits them; what the work writes (comments, review remarks, local changes' records, the counter) is original data in `~/.crewdeck/local.db`, apart from `miroir.db`, moved by versioned migrations, never touched by a rebuild (risk OPS-10). ADR 0012, « The Source wins »: each Ticket's `contentHash` is an HMAC of its title and body keyed from the vault key. « Consequences »: `apps/runner/internal/source/` holds one package per Source behind one interface (read, write, watch, copy), used by the Miroir and the migration.

This ticket is the Runner's Local package and the Sessions of a Local Projet. Its users: SOURCE-3 (the watcher and the report), SOURCE-4 (the reads through the relay), SOURCE-5 (the changes' branches and the merge), MIROIR-6 (the agents' reads of Local in gh's shapes), MIROIR-7 (the agents' writes), SOURCE-6 (`contentHash`), SOURCE-8 (the copy).

## Current state of the code

- `apps/runner/internal/state/state.go`: `runner.json` (`Server`, `RunnerID`, `Token`), the folder `~/.crewdeck/` (mode 700, `CREWDECK_HOME`), `Store.write` (mode 600, at once).
- `apps/runner/internal/keys/vault.go`: `Vault` (`SealItem`, `OpenItem`); `aead.go`: `HMACSHA256`; `apps/runner/cmd/crewdeck-runner/vault.go`: `openVault`.
- `apps/runner/internal/mirror/`: `miroir.db` (`store.go`, `schema.sql` v1, `Rebuild`), `modernc.org/sqlite` in `go.mod`, `gopkg.in/yaml.v3` too.
- `apps/runner/cmd/crewdeck-runner/maintenance.go`: `uninstall` asks « Supprimer le Runner, ses clones et ~/.crewdeck ? (o/N) », then removes `~/.crewdeck/`.
- Created by RUNNER-9: `session.start` (`packages/contracts/src/runner/session.ts`, its `origin` a discriminated union of the one member `{ kind: 'github', owner, name }`, `branch`, `base`, a readable `title`), the `Origin` interface of `apps/runner/internal/session/clone.go` (`Clone(ctx) (dir, err)`, GitHub's under `~/.crewdeck/repos/github/<owner>/<name>`), the worktrees `~/.crewdeck/worktrees/<projectId>/<branch>`, `session.state` errors (`clone-failed`), `SessionsService.start` answering 422 `sessions.no-origin` for a Projet without a repository, `AgentSession` (`apps/server/src/sessions/`).
- Created by PROJET-6: a Local Projet (`Project` without a repository, `nameSealed`), its folder checked live by the Runner (`folder.check`), the path kept only in the Runner's state (`State.Projects`: projectId → absolute path, in `runner.json`), the Décision `project.folder-missing`.
- Created by SOURCE-1: `artifact_sources` (`ticket`, `code`; `local | github`) and `apps/server/src/process/sources/`.
- No `internal/source/`, no `local.db`.

## To do

- **The interface** `apps/runner/internal/source/source.go`: the values in neutral Go (`Ticket { Number, Title, Body, State open|closed, StateReason completed|not_planned|"", Ready, Labels, Milestone *Milestone{ Number, Title, DueOn }, BlockedBy, Parent, CreatedAt, UpdatedAt, ClosedAt }`, `Comment { ID, Author, Body, CreatedAt }`, `Change { Number, Title, Body, HeadRef, HeadOid, BaseRef, State open|closed|merged, IsDraft, MergeCommitOid, Author, CreatedAt, UpdatedAt, ClosedAt, MergedAt }`, `Review { ID, Author, State, Body, CommitOid, SubmittedAt, Comments }`, `Check { Name, Status, Conclusion }`) and four small interfaces, `Reader` (`Tickets`, `Ticket`, `Comments`, `Milestones`, `Changes`, `Change`, `Reviews`, `Checks(sha)`), `Writer` (`CreateTicket`, `EditTicket`, `SetTicketState`, `Comment`), `Watcher`, `Copier`; this ticket implements `Reader` and `Writer` for Local (`Checks` gives none until BOUCLE-9 records the Checks' Commandes; the changes' writes are MIROIR-7's); `Watcher` is SOURCE-3's, `Copier` SOURCE-8's. gh's shapes are made from these values by MIROIR-6.
- **`contentHash`** `apps/runner/internal/source/hash.go`: `Vault.DeriveKey(label) []byte` added to `keys/vault.go` (HMAC-SHA256 of the vault key and the label); `ContentHash(vault, title, body) string` = `v<vaultVersion>.` + base64url(HMAC-SHA256(DeriveKey("crewdeck/v1/content-hash"), title + "\n\n" + body)), the body's line endings made `\n` and its trailing whitespace trimmed. Used for both Sources.
- **`local.db`** `apps/runner/internal/source/local/db.go`: `~/.crewdeck/local.db` (mode 600, WAL), migrations embedded from `local/migrations/0001_init.sql` and applied in order in one transaction each, `PRAGMA user_version` the last applied; a file of a newer version than the binary knows is never opened (« local.db vient d'une version plus récente du Runner : mets-le à jour avec crewdeck-runner update. »). Schema v1:
  - `projects (project_id PK, next_number)`: the counter shared by Tickets and changes;
  - `tickets (project_id, number, path, created_at, updated_at, closed_at, content_hash, PK (project_id, number))`: what the files do not hold (dates, the last hash);
  - `comments (id PK, project_id, number, author, body, created_at, session_id)`;
  - `changes (project_id, number, title, body, head_ref, head_oid, base_ref, state open|closed|merged, is_draft, mergeable, merge_commit_oid, author, session_id, created_at, updated_at, closed_at, merged_at, PK)`, `reviews (id PK, project_id, number, author, state APPROVED|CHANGES_REQUESTED|COMMENTED, body, commit_oid, submitted_at)`, `review_comments (id PK, review_id, path, line, body, created_at)`: the tables of local changes, written by MIROIR-7 and SOURCE-5.
  The running Runner is the only writer; others open it read-only.
- **Ticket files** `apps/runner/internal/source/local/ticketfile.go`: `Parse(data) (TicketFile, error)` and `Format(TicketFile) []byte` for the ADR's front matter (`number`, `title` required, `state` open|closed default open, `state_reason`, `ready` default false, `labels`, `blocked_by`, `parent`, `milestone` a title or null) and the body, through `yaml.v3` nodes so that a rewrite keeps the keys' order, the Pilote's other keys and comments; a file with no front matter whose first line is `# <titre>` reads as that title and the rest as body.
- **The Local project** `apps/runner/internal/source/local/project.go`, `Open(db, vault, projectID, folder)`:
  - `Scan(ctx) (Scan{ Tickets, Milestones, Unreadable []{ Path, Reason: front-matter|duplicate-number } }, error)` reads `<folder>/tickets/*.md` and `milestones.yml` from the folder's working tree; a file without `number` gets `next_number`, its front matter gains `number` first, and it is renamed `tickets/<n>-<slug>.md` (slug: accents removed, lower case, `[^a-z0-9]+` → `-`, 50 characters at most cut at a `-`, `ticket` if empty; `-2`, `-3` when taken); two files with one number: the first by path keeps it, the others are `duplicate-number`; `next_number` is kept above every number seen; dates and hashes updated in `tickets`;
  - `Ticket(ctx, n)`, `Comments(ctx, n)`, `Milestones(ctx)` (`tickets/milestones.yml` in its order, `Number` the entry's rank from 1, as MIROIR-6 shows it), `Changes`, `Change`, `Reviews` from `local.db`;
  - `CreateTicket`, `EditTicket` (title, body, labels added and removed, ready, milestone, blocked_by, parent), `SetTicketState(n, state, reason)`, `Comment(n, author, body, sessionID)`: the file written in place in the working tree at once (a temporary file then a rename), never `git add` nor `commit`; an unknown milestone title is refused (`ErrUnknownMilestone`);
  - `OnChange(func(Change{ ProjectID, Kind: ticket|change|milestone, Number }))`: called after every write and every change a scan finds, for SOURCE-3's report.
  - `ProjectOfRemote(url) (projectID, ok)`: the Local Projet whose folder a clone's `origin` names (for MIROIR-6 and MIROIR-7, which find the Projet from a worktree).
- **The Local origin of a Session**: RUNNER-9's `origin` union gains `{ kind: 'local' }` (its fixture, `pnpm exec nx run contracts:generate`); `SessionsService.start` sends it when the Projet's `code` Source is Local (SOURCE-1), instead of 422 `sessions.no-origin`; a Local Projet's Session has no readable title: `session.start.title` and `AgentSession.title` become nullable and `AgentSession` gains `titleSealed` (the Ticket's or Conception's sealed title as the server holds it, `zSealed` of `packages/contracts/src/keys/`), which the page opens. The Runner's `Origin` gets its Local implementation (`apps/runner/internal/source/local/origin.go`): `git clone --no-hardlinks <folder> ~/.crewdeck/repos/local/<projectId>` once, `git fetch origin` before each Session, worktrees as for GitHub; no token, no askpass; a folder absent from `State.Projects`, or gone, ends the Session with `clone-failed`. A Session's `git push origin <branch>` lands in the folder. Any other user of `Origin` (RUNNER-18's Commandes) gets the Local one through it.
- The running Runner (`cmd/crewdeck-runner/run.go`) opens `local.db` and one Local project per entry of `State.Projects`.
- `crewdeck-runner uninstall`: when `local.db` holds a comment, a change or a review, prints before the question (and with `--yes`) « local.db contient ce que le travail a écrit sur tes Projets Locaux (commentaires, remarques, changements de code) : il sera supprimé avec le Runner. »
- `crewdeck-runner miroir rebuild` and a new `mirror.SchemaVersion` remove `miroir.db` only (a test asserts `local.db` untouched).
- `docs/pilotage/risques.json`: OPS-10's two solutions ticked.

## Decisions already made

- Tickets are read from the folder's working tree, not from a commit: the Pilote's unsaved-in-git edits are the Ticket (ADR 0012, « The Runner writes Tickets in place… and never commits them »). Documents are read from the integration branch's committed files in the clone, as on GitHub.
- Renaming a new file to `<n>-<slug>.md` is the only change the Runner makes to a file it did not write; a file already numbered keeps its name.
- A duplicate number is reported, never renumbered: the Runner does not decide which of the Pilote's two files is the Ticket. SOURCE-3 turns `Unreadable` into the Décision `ticket.local-unreadable`.
- The hash carries the vault key's version, so that a hash made under a rotated key is never compared with one of another version (SOURCE-6 recomputes from the snapshot then).
- Dates of a Local Ticket: `createdAt` its first sight by the Runner, `updatedAt` its file's modification time, `closedAt` its first sight closed; kept in `local.db`, since the file holds none.
- `local.db` is never rebuilt: a migration keeps the data, and no code path deletes it but `uninstall` (ADR 0012, OPS-10).

## Acceptance criteria

- [ ] A temporary git repository with `tickets/a.md` (front matter without `number`) and `tickets/7-x.md`: `Scan` numbers `a.md` as 8, renames it `tickets/8-<slug>.md` with `number: 8` first and the Pilote's other keys and comments kept; the folder's `git status` shows the rename as an uncommitted change and no commit was made.
- [ ] Two files with `number: 3`: the first keeps it, the second is `Unreadable` with `duplicate-number`; a front matter that does not parse is `Unreadable` with `front-matter`, and the other files still read.
- [ ] `CreateTicket` writes `tickets/<n>-<slug>.md` with the next number shared with changes; `EditTicket` and `SetTicketState(closed, not_planned)` rewrite only the fields given; `Comment` writes a `comments` row; each calls `OnChange`.
- [ ] `ContentHash` is stable across a CRLF/LF change and a trailing newline, differs when the body changes, and two vault keys give two hashes.
- [ ] `local.db` is created mode 600 at v1; a database of v2 is refused with its message; a migration test applies v1 on an empty file and keeps rows across a re-open.
- [ ] A Session with `origin: { kind: 'local' }`: the Runner clones the folder, makes the worktree, and the fake Engine's `git push origin feat/3-x` creates `feat/3-x` in the folder; the folder's checked-out branch and its uncommitted files are untouched.
- [ ] `miroir rebuild` leaves `local.db` byte for byte; `uninstall` prints the warning when `local.db` holds a comment.
- [ ] The fixture of `session.start` with each origin is valid in TypeScript and Go.

## Verification

- `cd apps/runner && go test ./internal/source/... ./internal/keys/ ./internal/session/ ./internal/mirror/ ./cmd/crewdeck-runner/ -run 'Local|Hash|Uninstall|Rebuild|Origin'`
- `pnpm exec nx test contracts -- src/runner/`, `pnpm exec nx test server -- src/sessions/`
- `pnpm exec nx run contracts:generate` with no diff, then `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- Following the folder (fsnotify, scans), `local.changed` and the server's rows, the Décision `ticket.local-unreadable`: SOURCE-3.
- Reading a Local Ticket, file, change or diff in the page: SOURCE-4. A change's branch followed and its merge: SOURCE-5.
- `crewdeck-runner miroir` reading Local: MIROIR-6; writing it: MIROIR-7.
- Picking the folder and `git init`: PROJET-6, PROJET-4.

## Dependencies

- RUNNER-9.
- PROJET-6.
