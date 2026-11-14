---
id: BOUCLE-9
title: "The Checks Étape du produit: the CI of the judged SHA through the GitHub Connecteur, or its Commandes in the worktree, one Verdict"
epic: BOUCLE
type: feature
priority: P1
size: M
milestone: M4 Boucle
blocked_by: [BOUCLE-4, PROCESS-12]
adr: [0011, 0013, 0002]
risques: []
stories: [US-106]
screens: []
revue_visuelle: false
video: false
---

## Context

US-106: the checks of a change of code are the CI of its GitHub repository, or Commandes on the Pilote's Runner (its tests, its linters) for a Projet without CI, so that every change is checked before its Review lets it merge. « Checks » is an **Étape du produit** (glossary): in every Process that merges code, never removed nor added. ADR 0011 (« The catalogue », « The engine »): its kind `checks` needs the capability `ci` (a `connector` Outil `github`, only when the Changement de code's Source is GitHub) or `command` (Commande Outils); it waits for the CI of the judged SHA or runs its Commandes. ADR 0013: the Checks run their Commandes in the worktree and give one Verdict, failed if one fails, which the Merge never passes and the Review reads. BOUCLE-4's `merge` handler waits for that Verdict on the SHA it merges; this ticket is its `checks` handler.

## Current state of the code

- No `apps/server/src/process/` nor `tickets` table on develop.
- Created by PROCESS-1: the catalogue's `checks` kind (family `core`, capabilities `ci` or `command`, Entrée `code-change`, Sortie `verdict`), the tools `{ kind: 'connector', connector: 'github' }` and `{ kind: 'command', commandId }`. Created by PROCESS-2: `findGaps` (`capability.missing` when the Checks have neither; `ci` refused on a Local code Source).
- Created by PROCESS-4: `StepKindHandler { kind, start(tx, run), onSignal(tx, run, signal) → StepResult | null, stop? }`, `StepResult { state: 'done', outputs, verdict? } | { state: 'failed', failure }`, `STEP_VERDICTS` (`passed`, `changes`, `failed`), `Engine.signal(tx, stepRunId, signal)` called by the domain modules, `step_runs` (`outputs`, `verdict`). Created by PROCESS-6: a Retour from the Review re-running the StepRuns from the Code, the Checks included, on the new head.
- Created by BOUCLE-1: `tickets` and `code_changes` with `source`, `TicketCheck` (`ticket_checks`: `ticketId`, `sha`, `name`, `state` `running | passed | failed`, `durationMs`, `url`) fed by `check_run`, `check_suite` and `status` webhooks and the reconciliation, `aggregateChecks(checks)` (`none | pending | passed | failed`).
- Created by BOUCLE-4: the `review` and `merge` handlers; `judgedVerdicts` (the Checks' Verdict reaching the Merge through the Review) and `mergeGate` merging only when every judged Verdict passed on the head; the Review's input `verdicts` and its rule `review.honours-inputs` (no `ok` over a failed Verdict); a new head re-feeding the Code's Étapes.
- Created by PROCESS-12: `CommandRunsService.start(tx, { stepRun, commandId, ref })`, `command_runs`, the hook `command-run.finished`, `apps/web/src/process/sealed.ts`. Created by RUNNER-18: a `worktree` Commande run in the Ticket's worktree at `ref.sha`.
- Created by MIROIR-6: `crewdeck-runner miroir pr view --json statusCheckRollup` in gh's shapes, for GitHub and Local.

## To do

- `apps/server/src/process/engine/kinds/checks.ts`, handler of `checks`:
  - `start`: the Entrée `code-change` gives `{ id, sha }`; the Outils give the modes: `ci` when a `connector github` Outil is attached, `command` for each `command` Outil, both when both are attached (all must pass).
  - **CI**: `start` answers `running`; on each `ticket_checks` change of that change's SHA (an in-process hook `ticket-checks.changed { ticketId, sha }` emitted by BOUCLE-1's handlers, which calls `Engine.signal` for the Checks StepRun judging that SHA), `aggregateChecks` of the rows of that SHA: `passed` or `failed` ends the CI part; `pending` waits. No check at all 10 minutes after the StepRun started: the CI part fails with reason `ci-none`. Checks of another SHA never count.
  - **Commandes**: one run after the other, in the order of the Outils, through `CommandRunsService.start` with `ref { stepId, ticket, branch, sha }`, each `command-run.finished` signalling the StepRun; a failed one ends the Commande part as failed (the next ones are not run). A failed Commande of the Checks raises no `command.failed` Décision: it is a failed Verdict.
  - The Verdict: `onSignal` answers `{ state: 'done', verdict: 'passed' | 'failed', outputs: [{ portId, type: 'verdict', id: stepRunId, sha }] }` once every part ended. A failed Verdict is a `done` StepRun with an output like a passed one: it feeds the Review, and the Merge never passes it (BOUCLE-4). The checks behind it are figures only: BOUCLE-1's `ticket_checks` rows and PROCESS-12's `command_runs` of that SHA (a Commande's check has no name, its text being sealed).
  - A new head on the change while the Checks run: BOUCLE-4 re-feeds the Code's Étapes at the new SHA; the StepRun judging the old one is stopped through the handler's `stop` (the CI wait dropped, a running Commande `command.stop`), never giving a Verdict.
- `packages/contracts/src/api/tickets.ts` (BOUCLE-1's): the Ticket's checks in `GET /api/projects/:id/tickets/:number` gaining the Commande checks of its head: `checks[]` items `{ origin, name?, commandId?, state, durationMs?, url? }`.
- **The Runner** (`apps/runner/internal/command/`): each run of a Checks Commande records `(projectId, sha, commandId, state, startedAt, durationMs)` in `~/.crewdeck/local.db` table `command_checks` (a versioned migration of SOURCE-2's schema); SOURCE-2's Local `Reader.Checks(sha)` returns them, and `miroir pr view --json statusCheckRollup` (MIROIR-6) appends them for a change whose head is that SHA, `{ __typename: 'CheckRun', name: <the first line of the Commande's text, 60 characters>, status: 'COMPLETED' | 'IN_PROGRESS', conclusion: 'SUCCESS' | 'FAILURE' | null, detailsUrl: null }`, on GitHub as on Local, so that the Review's agent reads them.
- The `checks` Étape of « Process Crewdeck » keeps its `connector github` Outil (PROCESS-1); on a Local Projet it gives the `capability.missing` Manque PROCESS-2 already asserts, and the Pilote attaches Commandes before activating: nothing to change there, a fixture `packages/contracts/fixtures/process/checks-commands.json` (both groups `local`, two Commande Outils on `st-checks`, no Manque) proves the way out.
- Tests: `apps/server/src/process/engine/kinds/checks.spec.ts` (each mode and each ending), an integration test with the fake GitHub (`check_run` webhooks on two SHAs) and the fake Runner (scripted `command.verdict`).

## Decisions already made

- The CI's verdict is GitHub's own aggregation of every check run and status of the SHA (BOUCLE-1's `aggregateChecks`): no list of required checks at the MVP, so a repository's branch protection stays its own business.
- 10 minutes with no check at all is a failed Verdict (`ci-none`), not a wait without end: a repository with no workflow uses Commandes instead, and the Review's agent sees why.
- The Checks' Commandes run sequentially and stop at the first failure: a lint after failed tests adds nothing the Review needs, and two Commandes in one worktree at once would race.
- No commit status is posted to GitHub for a Commande: GitHub learns nothing of what runs on the Pilote's machine; the Miroir carries it to the agents.
- A failed Checks Verdict is not a Décision: the Review reads it and asks for changements, its Retour to the Code fixes it (PROCESS-6); the Retour's maximum stops the Ticket.
- The Checks never judge (`judges: false` in the catalogue): no Retour leaves them.

## Acceptance criteria

- [ ] With a `connector github` Outil, `check_run` success events on SHA `a1…` give a passed Verdict on `a1…`; a failure on `a1…` a failed one; checks on `b2…` change nothing for the StepRun judging `a1…`.
- [ ] With no check on the SHA after 10 minutes (fake clock), the Verdict fails with `ci-none`.
- [ ] With two Commande Outils, both run in the worktree at the SHA, one after the other; the first failing ends the Verdict as failed and the second never runs; no `command.failed` Décision is raised.
- [ ] With both a GitHub Outil and a Commande, the Verdict passes only when both pass.
- [ ] A passed Verdict reaches the Merge, which merges at that SHA (BOUCLE-4); a failed one reaches the Review and the Merge does not merge.
- [ ] A push during the CI wait stops that StepRun without a Verdict, and a new one judges the new SHA.
- [ ] `miroir pr view <n> --json statusCheckRollup` lists the Checks' Commandes of the head with their conclusion, on a Local change and on a GitHub PR (Go test).
- [ ] The Ticket's `GET` lists its CI and Commande checks of its head, each with its `origin`.

## Verification

- `pnpm exec nx test server -- src/process/engine/kinds/checks.spec.ts`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- checks`
- `pnpm exec nx test contracts -- src/process/gaps.spec.ts`
- `cd apps/runner && go test ./internal/command/ ./internal/mirror/ -run 'Checks|Rollup'`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

Nothing (the `local.db` migration runs on the Runner's update).

## Out of scope

- Running a Commande, its sealed text, `command_runs`: PROCESS-12, RUNNER-18. « Préparer le worktree » before the Commandes: RUNNER-20.
- The Merge and the Review's reading of the Verdict: BOUCLE-4. Showing the Commande checks on the Ticket's page: BOUCLE-5.
- Attaching the Outils on the canvas: PROCESS-9.

## Dependencies

- BOUCLE-4
- PROCESS-12
