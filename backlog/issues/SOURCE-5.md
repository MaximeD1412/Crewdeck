---
id: SOURCE-5
title: "A local change of code follows its branch in the folder, and merge.local: squashed at the judged SHA in the clone, the folder fast-forwarded, « Merge en attente » retried when the folder changes"
epic: SOURCE
type: feature
priority: P1
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [SOURCE-3]
adr: [0012, 0002]
risques: [AGT-8]
stories: [US-99, US-15]
screens: []
revue_visuelle: false
video: false
---

## Context

US-15: each Ticket is delivered as a change of code (a branch on a Local Projet) that the Review and the checks judge, and that the Boucle merges once they pass. ADR 0012, « The Local folder »: a local Changement de code is a branch and a record of the Runner, numbered from the Projet's counter; the merge is bound to the SHA every Verdict judged (ADR 0002): the Runner squashes the branch in its clone on the folder's integration head, then fast-forwards the folder, `git merge --ff-only` when the integration branch is checked out there (which git refuses only if the Pilote's uncommitted changes touch the same files), `git update-ref` with the old value otherwise; a refusal raises the Décision `merge.local-blocked` (« Merge en attente : tes modifications touchent les mêmes fichiers »), retried when the folder changes. A Conception's document is approved the same way. Risk AGT-8: a merge must never overwrite the Pilote's uncommitted work. Used by BOUCLE-4 (the `merge` kind), CONCEPTION-4 and PROJET-5 (approvals).

## Current state of the code

- Created by SOURCE-2: `local.db` (`changes` with `head_ref`, `head_oid`, `base_ref`, `state`, `mergeable`, `merge_commit_oid`, `merged_at`), the Local Reader (`Change`, `Changes`), the clone `~/.crewdeck/repos/local/<projectId>` with the folder as `origin`, `State.Projects`, `OnChange`.
- Created by SOURCE-3: the watcher (`OnRefsMoved(projectID)` on the folder's `.git/HEAD`, `refs/heads/`, `packed-refs`; polling under `/mnt/<x>/`), `local.changed` with its `change` items, the server's handler writing `code_changes` with `source: 'local'`.
- `apps/server/src/decisions/decisions.service.ts` (`raise`, `resolve`), `DECISION_KINDS`; `RunnerCommands.send` (422 `runner.offline`), `registerRunnerHandler`.
- The records themselves are written by MIROIR-7 (`miroir pr create|edit|review|close`), not a blocker: this ticket's tests insert them in `local.db`.

## To do

- **The change follows its branch** `apps/runner/internal/source/local/changes.go`: on `OnRefsMoved` and on each scan, for each open change, `refs/heads/<head_ref>` read in the folder: moved → `head_oid`, `updated_at`, and `mergeable` (`git merge-tree --write-tree origin/<base_ref> <head>` in the clone after a `git fetch origin`: `MERGEABLE` or `CONFLICTING`) written, `OnChange` called (SOURCE-3 reports the new `headSha`); the branch deleted from the folder → the change `closed`.
- **Protocol** `packages/contracts/src/runner/merge.ts`, fixtures, `pnpm exec nx run contracts:generate`: server → Runner `merge.local { projectId, changeNumber, sha }`; Runner → server `merge.local.result { projectId, changeNumber, sha, outcome: 'merged'|'conflict'|'blocked'|'stale', mergeSha? }`.
- **Runner** `apps/runner/internal/source/local/merge.go`, one merge at a time per Projet:
  1. `git fetch origin` in the clone; the change's head in the folder must be `sha`, else `stale`;
  2. a temporary worktree `~/.crewdeck/worktrees/<projectId>/merge-<n>` detached at `origin/<base_ref>`, `git merge --squash <sha>`; a conflict → `conflict`; else a commit `<title> (#<n>)` with the folder's `user.name` and `user.email` (`git -C <folder> config`), « Crewdeck » <crewdeck@localhost> when unset;
  3. the commit pushed to the folder as `refs/crewdeck/merge/<n>`;
  4. the folder's `HEAD` on `refs/heads/<base_ref>`: `git -C <folder> merge --ff-only <squash>`; git refusing because local changes would be overwritten → `blocked`, the files it names kept in `local.db` (the next migration: `pending_merges (project_id, number, sha, files, since)`); otherwise `git -C <folder> update-ref refs/heads/<base_ref> <squash> <old>`, the old value being the one the squash was made on; the folder's integration moved meanwhile → back to 1, at most three times, then `stale`;
  5. `refs/crewdeck/merge/<n>` and the temporary worktree removed; on `merged`: the change `merged`, `merge_commit_oid`, `merged_at`, `OnChange`; the answer sent.
  - A `blocked` merge is retried by the Runner itself: every 5 s while the files it named are still modified in the folder's working tree (`git status --porcelain -- <files>`), and at once on `OnRefsMoved`; each retry sends its own `merge.local.result`. A change closed, or a new `merge.local` for it, ends the pending one.
  - The Pilote's working tree is never touched but by `merge --ff-only`; no `stash`, `reset`, `checkout` nor `clean` in the folder.
- **Server** `apps/server/src/process/sources/local-merges.ts`:
  - `LocalMerges.request(pilotId, { projectId, changeNumber, sha })` sending `merge.local` (422 `runner.offline`), the caller being BOUCLE-4's `merge` kind or an approval;
  - the `merge.local.result` handler, in one transaction: emits the in-process hook `local-merge.finished(result)` for the caller; `blocked` raises `merge.local-blocked` (added to `DECISION_KINDS`; one open per `subjectId = <projectId>:<changeNumber>`, `subjectType: 'code-change'`, tone `caution`, label « Merge en attente : tes modifications touchent les mêmes fichiers », meta « Changement #<n> », link `/projets/<projectId>`, no action: it resolves itself); any other outcome resolves it (`outcome` the result's).
- `docs/pilotage/risques.json`: AGT-8's solutions ticked.

## Decisions already made

- `stale` beside BOUCLE-4's three outcomes: a head that moved after the Verdicts is never merged (ADR 0002); the caller treats it as GitHub's `github.head-moved` and judges again.
- The squash is made on the folder's integration head as the clone just fetched it, and `update-ref` takes that value as the old one: a commit the Pilote made meanwhile is never lost, the merge is redone on top of it.
- The files git names stay on the Runner; the server's Décision names none of them (ADR 0003).
- The squash commit carries the Pilote's identity of the folder: it lands in their history, from their own gates (ADR 0012, « the folder's git history is the Pilote's »).
- Retrying on a 5 s look at the named files, rather than a recursive watch of the whole working tree: cheap, and the Décision goes as soon as the Pilote commits, stashes or discards them.

## Acceptance criteria

- [ ] A temporary folder with `develop` checked out and a change on `feat/3-x` at SHA `a1…`: `merge.local` with `a1…` squashes it, `develop` in the folder points to the squash commit `<title> (#3)`, and the change is `merged` with its `mergeSha`.
- [ ] The Pilote's uncommitted change of another file stays as it was after the merge; an uncommitted change of a file the change touches gives `blocked`, the file and the folder untouched, and the Décision raised once; reverting that file retries the merge within 6 s, `merged`, the Décision resolved.
- [ ] `develop` not checked out in the folder: the merge moves it with `update-ref`; a commit added to `develop` between the fetch and the update makes the Runner redo the squash on top of it.
- [ ] `merge.local` with a SHA that is not the head gives `stale` and merges nothing; a conflicting change gives `conflict`.
- [ ] A Session's push moving `feat/3-x` updates `head_oid` and `mergeable`, and the server's `code_changes.headSha` through `local.changed`.
- [ ] The Décision and the server's logs hold no file name (marker string test).
- [ ] The fixtures of `merge.local` and its result are valid in TypeScript and Go.

## Verification

- `cd apps/runner && go test ./internal/source/local/ -run 'Merge|Change'`
- `pnpm exec nx test contracts -- src/runner/`
- `pnpm exec nx test server -- src/process/sources/`
- `pnpm exec nx run contracts:generate` with no diff, then `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing (the `local.db` migration runs on the Runner's update).

## Out of scope

- Opening, editing, reviewing and closing a local change: MIROIR-7. Its Checks: BOUCLE-9.
- When the Boucle merges and what it does with each outcome: BOUCLE-4. Approving a document: CONCEPTION-4, PROJET-5.

## Dependencies

- SOURCE-3.
