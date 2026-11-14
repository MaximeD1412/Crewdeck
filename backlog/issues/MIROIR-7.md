---
id: MIROIR-7
title: "The agents' writes for every Source: crewdeck-runner miroir issue create|edit|comment|close|reopen and pr create|edit|comment|review|close, with gh's flags, the copy fresh after each"
epic: MIROIR
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [MIROIR-6, SOURCE-2, RUNNER-10]
adr: [0012, 0010]
risques: []
stories: [US-99, US-15]
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0012, « The agents' one channel, for every Source »: every write of an agent goes through the Miroir, `miroir issue create|edit|comment|close|reopen` and `miroir pr create|edit|comment|review|close`, with `gh`'s flags; on GitHub they call the API with the Session's token, then refresh the copy (what `crewdeck-runner gh` did, ADR 0010); on Local they write the Ticket file or the record of `local.db`, then report. The official Skills use `miroir` only (RUNNER-12), so that one Skill and one Contrat serve both Sources; the `gh` shim stays in a GitHub Projet's Sessions for what has no `miroir` command. Users: the Code Étape opening its change (BOUCLE-3), the Review's Verdict (BOUCLE-4), the blocked Ticket's comment (BOUCLE-5), the Découpage writing Tickets (CONCEPTION-9), an Idée turned into a Ticket (IDEE-5), the Source winning (SOURCE-6).

## Current state of the code

- Created by RUNNER-10: the Session's GitHub token (`POST /api/runner/sessions/:id/github-token`, the Runner's `TokenSource` renewed in memory, asked over the Session's control socket by `crewdeck-runner` run inside it), `crewdeck-runner gh` and the `gh` and `mirror` shims of `~/.crewdeck/sessions/<id>/bin/`, `ghrefresh.go` (`Named(args, stdout)`), the refresh through `runner.sock`.
- Created by MIROIR-6: `crewdeck-runner miroir` (`apps/runner/cmd/crewdeck-runner/miroir.go`: the Projet resolved from `--repo <key>` or the worktree's `origin`, `issue …` on the key of the `ticket` group and `pr …` on the `code` group's, the reads in gh's shapes, `url` of a Local Ticket its `file://` URL), `apps/runner/internal/localsock/` (`runner.sock`, ops registered by name, `mirror.fetch { repository, number }` refreshing one object of a GitHub or Local key, 30 s), the copy's `projects` with `integration_branch`, `apps/runner/internal/mirror/local.go` reading Local through SOURCE-2's interface; `internal/source/github/` left to this ticket.
- Created by SOURCE-2: `apps/runner/internal/source/` (`Writer`: `CreateTicket`, `EditTicket`, `SetTicketState`, `Comment`; the Reader of changes and reviews), `local/` (Ticket files written in place, never committed, numbering from the counter shared with changes, `ErrUnknownMilestone`, `OnChange`), `local.db` with `changes`, `reviews`, `review_comments`, `comments`, the clone with the folder as `origin`.
- No write command in `miroir`.

## To do

- **Commands** `apps/runner/cmd/crewdeck-runner/miroir_write.go`, `gh`'s flags:
  - `issue create` (`-t/--title`, `-b/--body`, `-F/--body-file` with `-` for stdin, `-l/--label` repeatable, `-a/--assignee`, `-m/--milestone <title>`), plus `--blocked-by N,…` and `--parent N` (Crewdeck's, for the Découpage);
  - `issue edit <n>` (`--title`, `--body`, `--body-file`, `--add-label`, `--remove-label`, `--add-assignee`, `--remove-assignee`, `--milestone`, `--remove-milestone`, `--add-blocked-by`, `--remove-blocked-by`, `--parent`, `--remove-parent`);
  - `issue comment <n>` (`-b`, `-F`); `issue close <n>` (`-r/--reason completed|"not planned"`, `-c/--comment`); `issue reopen <n>` (`-c`);
  - `pr create` (`-t`, `-b`, `-F`, `-B/--base` default the Projet's integration branch, `-H/--head` default the worktree's branch, `-d/--draft`, `-l`, `-a`, `-m`); `pr edit <n>` (title, body, labels, assignees, milestone, `--base`); `pr comment <n>`; `pr review <n>` (`-a/--approve`, `-r/--request-changes`, `-c/--comment`, `-b`, `-F`); `pr close <n>` (`-c`, `-d/--delete-branch`).
  - Output as `gh`: the object's URL on stdout (its `url` as `miroir … view --json url` gives it); `create` also takes `--json number,url` and prints that object.
  - Writes run inside a Session only (`CREWDECK_SESSION_ID` and its control socket): outside, exit 1, « Les écritures du Miroir se font depuis une Session. »; `pr merge`, `pr ready` and the other `gh` subcommands are not provided (`pr merge`: exit 1, « Le merge passe par Crewdeck. »).
- **GitHub** `apps/runner/internal/source/github/write.go` (the `Writer` for a GitHub key), with the Session's token: issues `POST /repos/{o}/{r}/issues`, `PATCH …/issues/{n}` (title, body, state, `state_reason`, milestone number looked up in the copy, assignees), labels `POST|DELETE …/issues/{n}/labels`, comments `POST …/issues/{n}/comments`, blocked-by `POST|DELETE …/issues/{n}/dependencies/blocked_by` (the blocker's issue id from the copy), parent `POST …/issues/{parent}/sub_issues` and `DELETE …/sub_issue`; pulls `POST /repos/{o}/{r}/pulls`, `PATCH …/pulls/{n}`, reviews `POST …/pulls/{n}/reviews` (`APPROVE|REQUEST_CHANGES|COMMENT`, `commit_id` the head in the copy), `--delete-branch` `DELETE …/git/refs/heads/<head>`. Then `mirror.fetch` of the object (30 s; its failure prints nothing and leaves the exit code). GitHub's refusal: exit 1 with its status and message, as `gh`.
- **Local** through `runner.sock`, the op `source.write { key, op, number?, fields, sessionId }` registered by the running Runner, which alone writes the folder and `local.db`:
  - Tickets: SOURCE-2's `Writer`; `--label ready-for-agent` and `--remove-label ready-for-agent` set the front matter's `ready` (never written as a label, as MIROIR-6 shows it), a milestone must exist in `tickets/milestones.yml` (exit 1, « Le jalon <titre> n'existe pas dans tickets/milestones.yml. »), assignees are refused on Local (exit 1, « Pas d'assignation sur un Projet Local. »);
  - changes `apps/runner/internal/source/local/changes.go`: `CreateChange` (the next number of the counter, `head_ref` that must exist in the folder, else « La branche <b> n'est pas dans le dossier : git push d'abord. », one open change per head, else « Un changement est déjà ouvert pour <b> : #<n>. », `head_oid` the folder's), `EditChange`, `CloseChange` (`--delete-branch`: `git push origin --delete <head>` from the clone), `Review` (a `reviews` row, `commit_oid` the head at that moment), comments in `comments`;
  - the author of what the work writes is the Session's Rôle (`code`, `review`…), as MIROIR-6 shows it; `OnChange` is called (SOURCE-3's report), then `mirror.fetch` refreshes the copy before the reply.
- Golden tests in `apps/runner/cmd/crewdeck-runner/testdata/miroir/`: the same command line on a GitHub key (recorded requests on MIROIR-3's fake GitHub) and on a Local key (the temporary git repository of MIROIR-6's fixtures), then the same `miroir … view --json` answer shape.

## Decisions already made

- One command line for both Sources: a Skill never tests the Source (ADR 0012). Where a Source cannot do what a flag asks (an assignee on Local), the command refuses rather than drops it.
- `--blocked-by` and `--parent` are Crewdeck's: `gh` has no flag for GitHub's native dependencies and sub-issues, which the Boucle reads (BOUCLE-1); the Découpage needs them on both Sources.
- The command writes GitHub itself with the Session's token, so the write is the agent's own (`crewdeck[bot]`, ADR 0002); a Local write goes to the running Runner, the one writer of the folder's Tickets and of `local.db`.
- The refresh is synchronous on both Sources: an agent that writes then reads sees its own write (ADR 0010).
- No `miroir pr merge`: merging is a gate of the Process (BOUCLE-4, SOURCE-5), never an agent's.

## Acceptance criteria

- [ ] `miroir issue create -t T -b B -l ready-for-agent --blocked-by 3 --parent 1 --json number,url` on a Local key writes `tickets/<n>-t.md` with `ready: true`, `blocked_by: [3]`, `parent: 1`, the next number shared with changes, no commit; on a GitHub key it calls the create, dependency and sub-issue endpoints (fake GitHub) with the Session's token.
- [ ] Right after either, `miroir issue view <n> --json labels,blockedBy,parent` answers the new values (no stale read).
- [ ] `issue close 4 -r "not planned" -c x` gives `state: closed`, `state_reason: not_planned` and a comment on both Sources; `issue reopen` reverses it.
- [ ] `pr create -H feat/4-x` on Local refuses a branch absent from the folder and a second open change on it; once pushed, it creates the record with the folder's head SHA; `pr review 5 -r -b x` records `CHANGES_REQUESTED` at the head.
- [ ] The same commands give the same `view --json` shapes on both Sources (golden test).
- [ ] Outside a Session the writes exit 1 with their message; `pr merge` exits 1; a GitHub refusal (422) exits 1 with its message.
- [ ] A failed refresh leaves the write done and the exit code 0.

## Verification

- `cd apps/runner && go test ./internal/source/... ./internal/localsock/ ./cmd/crewdeck-runner/ -run 'MiroirWrite|Local|Github'`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The reads: MIROIR-6. The Skills using these commands: RUNNER-12.
- A change's branch followed and its merge: SOURCE-5. The report of Local writes to the server: SOURCE-3.

## Dependencies

- MIROIR-6.
- SOURCE-2.
- RUNNER-10.
