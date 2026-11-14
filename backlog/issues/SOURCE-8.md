---
id: SOURCE-8
title: "Migrating the Tickets between Local and GitHub: an idempotent copy marked with its origin, verified until stable, new numbers at the switch, the old place frozen"
epic: SOURCE
type: feature
priority: P1
size: M
milestone: M7 Statistics and switchover
blocked_by: [SOURCE-7, SOURCE-3, MIROIR-7]
adr: [0012]
risques: [OPS-8]
stories: [US-102]
screens: []
revue_visuelle: false
video: false
---

## Context

US-102's example: « the 30 local Tickets become 30 issues, with their state and history », and back. SOURCE-7 built the migration's state machine, its draining, its switch and its page; this ticket is the Runner's work for the `ticket` group and the server's switch hook for it. ADR 0012 (« Moving a Source »): copying is idempotent, each copy carrying its origin so that a retry reuses what it finds; verifying recopies what changed meanwhile until a pass finds no change; the switch gives each Ticket its new number (the old one shown « ex-#12 »); after it, the old place is frozen and compared once more, any late change carried to the new Source. Risk OPS-8: a migration half done never leaves two Sources nor loses a Ticket.

## Current state of the code

- `apps/runner/internal/`: `github/` (REST reader with a `TokenSource`), `mirror/`, `protocol/`, `state/`; no `source/` nor `migration/` on develop.
- `apps/server/src/github/github.client.ts` (`GitHubClient`), `apps/server/src/testing/fake-github.ts`.
- Created by SOURCE-7: `source_migrations`, the protocol `migration.copy`, `migration.progress`, `migration.switch { fingerprints, renumbering }`, `migration.finish`, `migration.finished`, `migration.failed`, `hello.migrations`, `registerSwitchHook(group, fn)`, the dialog's per-group sentences, the Décisions.
- Created by SOURCE-2: `apps/runner/internal/source/` (one interface: read, write, watch, copy), `local/` (the Ticket file `tickets/<n>-<slug>.md`, `tickets/milestones.yml`, numbering from the Projet's counter, `local.db` with comments, `contentHash`). Created by SOURCE-3: the watcher, `local.changed`, the server's `tickets` rows with `source: local` and sealed texts.
- Created by MIROIR-7: the Miroir's writes (`miroir issue create|edit|comment|close|reopen`) for GitHub and Local. Created by MIROIR-3 and MIROIR-4: the Runner's copy of the repository's issues, its follower.
- Created by BOUCLE-1: `tickets` (`source`, `number`, `state`, `stateReason`, labels, `blockedBy`, `parent`, milestone), `milestones`, their GitHub handlers and `tickets.reconcile.ts`. Created by RUNNER-10: `POST /api/runner/sessions/:id/github-token`, the installation tokens restricted by repository and permission.

## To do

- **Token**: `POST /api/runner/source-migrations/:id/github-token` (Bearer Runner token) → `{ token, expiresAt }`, an installation token for the Projet's repository with `issues: write`, while the migration is `copying`, `verifying` or `switched` (else 422 `source-migration.not-running`; 404 another Pilote's). Never stored nor logged.
- **`Copier`** of SOURCE-2's interface, implemented for Local and for GitHub; **`apps/runner/internal/source/github/`**: `Reader` and `Writer` for Tickets on GitHub (read from the Miroir's copy, write through the REST API with that token): issues, labels, milestones, comments, sub-issues, blocked-by, lock.
- **`apps/runner/internal/migration/`**: the handler of `migration.copy` and `migration.finish` for `group: ticket`, its progress in `~/.crewdeck/migrations/<migrationId>.json` (mode 600) so that a restart resumes; `hello.migrations` lists `ticket`.
  - **Local → GitHub**, by number: the milestones by title (with `due_on`), the missing labels; each Ticket an issue (title, body ending with `<!-- crewdeck:from local#<n> -->`, labels, `ready-for-agent` when `ready`, milestone), found first by that marker; its comments from `local.db` in order, each « **<auteur>**, le <date> : » then its text and `<!-- crewdeck:from local#<n>/comment/<id> -->`; then its state and `state_reason`. Once every issue exists, parents (sub-issues) and blocked-by from the renumbering.
  - **GitHub → Local**, issues only (never PRs): each one `tickets/<n>-<slug>.md` (number from the Projet's counter, `from: github#<n>` in the front matter, state, `state_reason`, `ready` from `ready-for-agent`, the product's and other labels, milestone, `blocked_by` and `parent` renumbered), found first by `from:`; its comments into `local.db` with author and date; the milestones into `tickets/milestones.yml`. Written in the working tree, never committed.
  - **Verifying**: passes over the old Source comparing each Ticket's state, `contentHash`, labels, milestone, comment count, parent and blocked-by with its copy, recopying what differs, until a pass finds no difference; then `migration.switch` with the fingerprints (`key` `local#12` or `github#57`) and the renumbering. Ten passes without a stable one fail `migration.unstable`.
  - **Finishing** (`migration.finish`): freeze, then compare the frozen place with the fingerprints and carry each late change to the new Source, then `migration.finished`. Frozen: leaving Local, `tickets/` renamed `tickets.archive-<YYYY-MM-DD>/` (`-2`, `-3` when it exists); leaving GitHub, every issue labelled `crewdeck:archive` (created if absent) and locked, its state unchanged. Then the Projet's Ticket Source switches in the Runner (the Miroir and its writes use the new one) and, for Local, a full `local.changed` scan is sent.
  - Failures, as `migration.failed { stage, code }`: `github.refused`, `github.unavailable` (after its own retries), `folder.unwritable`, `local.unreadable` (a Ticket file that does not parse: never skipped), `migration.unstable`.
- **Server** `apps/server/src/process/sources/migrations/tickets.switch.ts`, the `ticket` hook: in the switch's transaction, every `tickets` row of the Projet gets its new `number`, `formerNumber`, `formerSource` and `source`, and its milestone rows likewise; to GitHub the sealed texts are cleared and BOUCLE-1's reconciliation of the Projet runs after the commit to fill the titles; to Local the plain texts are cleared, the Runner's scan seals them again. A renumbering that misses a row, or names an unknown one, throws (SOURCE-7 then fails the migration before the point of no return).
- BOUCLE-1's GitHub handlers and SOURCE-3's `local.changed` write `tickets` only for a Projet whose `ticket` Source is theirs: the issues or files a copy creates are not rows before the switch.
- Contracts: `zTicket` gains `formerNumber` and `formerSource` (nullable); the Ticket's page header and the Ticket rows add « ex-#<n> » after the number.
- The dialog's sentences for the group (SOURCE-7's slots): « Puis les <n> Tickets du dossier tickets/ deviennent <n> issues, d'un coup, avec leur état et leur historique. » and « Le dossier tickets/ est archivé, figé : plus rien ne s'y écrit. »; back: « Puis les <n> issues deviennent <n> fichiers du dossier tickets/, d'un coup, avec leur état et leur historique. » and « Les issues sont archivées : étiquetées crewdeck:archive et verrouillées, sans être fermées. ».
- Tests: Go, a temporary git folder and an `httptest` GitHub recording its calls (`internal/migration/`); server, the hook and the reconciliation after it (integration, fake GitHub); the token route's baseline.
- `docs/pilotage/risques.json`: OPS-8's idempotent copy and late-changes solutions ticked.

## Decisions already made

- The origin markers are the idempotency (ADR 0012): no separate table of what was copied; a retry, or a Runner restarted mid-copy, finds its copies by them.
- Comments become one comment each on GitHub (by `crewdeck[bot]`), their author and date in the first line: the App cannot post as the Pilote nor backdate.
- A copy keeps the product's labels and every other label; `ready-for-agent` stands for `ready: true` on GitHub and back.
- Archived issues are never closed (ADR 0012, « Options that lost »: thirty notifications and a false state); PRs are never touched by the `ticket` group.
- Local Tickets are written in the working tree and never committed: the folder's git history is the Pilote's.
- A Ticket file that does not parse fails the copy rather than be skipped: no Ticket is lost (OPS-8).
- The verify pass compares hashes and states only: the server never sees a text, the Runner compares on the machine.

## Acceptance criteria

- [ ] Thirty Local Tickets (two closed `completed`, one `not_planned`, with comments, a parent, blocked-by and two milestones) become thirty issues with their state, reason, labels, milestones, one comment each, sub-issues and blocked-by (recorded fake GitHub calls).
- [ ] A copy interrupted after twelve issues, then resumed, creates the eighteen others and no duplicate.
- [ ] A Local Ticket edited during verifying is recopied, and the switch comes after a pass without change.
- [ ] The switch renumbers every row (#12 shown « #57 (ex-#12) »), in the same transaction as the Source; the titles are filled by the reconciliation.
- [ ] After the switch, `tickets/` is renamed `tickets.archive-<date>/`; a file edited between the last pass and the freeze is carried to its issue.
- [ ] GitHub → Local writes one file per issue, never for a PR; the issues are labelled `crewdeck:archive` and locked, still open or closed as they were.
- [ ] A Ticket file that does not parse fails the migration with `local.unreadable`; the Tickets stay Local and the Boucle takes them again.
- [ ] Issues created by the copy create no `tickets` row before the switch.
- [ ] The token route answers 422 for a migration not running, 404 for another Pilote's; the token never appears in the logs.

## Verification

- `cd apps/runner && go test ./internal/migration/ ./internal/source/...`
- `pnpm exec nx test server -- src/process/sources/migrations/tickets.switch.spec.ts`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- source-migrations`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

A migration (columns `tickets.former_number`, `tickets.former_source`). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- The state machine, draining, the switch's transaction, the page and the Décisions: SOURCE-7.
- The `code` group (branches, changes of code, documents), picking a repository or a folder: SOURCE-9.
- Keeping the old place as a Copie instead of archiving it: the Bêta, no ticket yet.

## Dependencies

- SOURCE-7
- SOURCE-3
- MIROIR-7
