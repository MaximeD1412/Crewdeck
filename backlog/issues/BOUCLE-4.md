---
id: BOUCLE-4
title: "Review Étape on a second Moteur, and the Boucle's merge bound to the judged commit"
epic: BOUCLE
type: feature
priority: P0
size: M
milestone: M4 Boucle
blocked_by: [BOUCLE-3]
adr: [0002, 0004, 0005, 0009]
risques: [IA-5, AGT-2]
stories: [US-15, US-39]
screens: []
revue_visuelle: false
video: false
---

## Context

US-15: each **Ticket** is delivered as a PR that a second agent and the checks review, and that the **Boucle** merges itself once they pass. Nobody reads the code before the merge (risks IA-5, AGT-2), so every gate is bound to the commit it judged (ADR 0002): the Review verdict, the Code **Contrat**'s verdict and the checks must all stand on the PR's head SHA, and the merge passes that SHA to GitHub, which refuses it if the head moved. The Review runs by default on another **Moteur** than the Code (US-39). Model: the founder's `agent-loop` steps 3 and 4.

## Current state of the code

- No code in the repository: only the docs and `design/`.
- Created by BOUCLE-3: the Code StepRun (`code-worker.ts`), the Code Contrat `packages/contracts/src/contrats/code.ts`, the Skill `apps/runner/skills/code/SKILL.md` with its « Modes » headings, `zLoopStep`; a passed Code verdict moves the Ticket to `in-review` with the judged SHA.
- Created by BOUCLE-2: `AgentLoop`, `LoopRecord` (`reviewRounds`, `outcome`), `loop-scheduler.ts`.
- Created by BOUCLE-1: `Ticket` (`headSha`, `checks`, `checksSha`, `prState`, `mergedBy`), `TicketCheck`, the `PullRequestReviewEvent` emitter.
- Created by CORE-3: `GitHubClient` with `merge` (squash, `sha`) and the fake GitHub.
- Created by ATOI-1: `DecisionsService`. Created by RUNNER-12: `StepsService`, `crewdeck-runner etape report`.
- Sources of the Skill: dotfiles repository `MaximeD1412/dotfiles`, `agents/tools/agent-loop/prompts/review.md`, `review-followup.md`, `review-schema.json`, `fix-review.md`, `fix-ci.md`, `fix-conflict.md`.

## To do

- Skill `apps/runner/skills/review/SKILL.md` (from `review.md` and `review-followup.md`): read-only review of the PR against the Ticket and `AGENTS.md`; post one PR review of kind `COMMENT` as `crewdeck[bot]`, with inline remarks (file and line) or general ones; write `.crewdeck/review.json` (`{ verdict: 'ok' | 'changements', headSha, remarks: [{ severity, file?, line?, general?, title }] }`) and end with `crewdeck-runner etape report`. A follow-up review reads its previous review on the PR and judges only what changed since.
- Contrat `packages/contracts/src/contrats/review.ts` (ADR 0005's Review row): `review.verdict` (`json`: `verdict` is `ok` or `changements`, `headSha` 40 hex), `review.remarks.located` (`check` `remarksLocated`: each remark has `file` and `line`, or `general: true`), `review.posted` (`pr`: a review by `crewdeck[bot]` on `headSha`). French labels; fixtures passing and failing.
- At the start of every Review StepRun, the Runner first evaluates the Code Contrat on the current head, so that both verdicts carry the same `headSha`.
- Server `apps/server/src/loops/review-worker.ts`: on `loopStep: in-review`, `StepsService.start({ step: 'review', role: 'review', subjectType: 'ticket', subjectId, input: { prNumber, headSha, round } })` with the effective `roles.review`. The verdict figures (`verdict`, remark count, `headSha`) reach the server through `step.report`; the remarks' text stays on GitHub.
- Prisma: on `Ticket`, `reviewVerdict?` (`ok` | `changements`), `reviewSha?`, `codeContractSha?`, `ciFixAttempts` (int, 0); `LoopRecord.reviewRounds` incremented at each Review StepRun.
- `apps/server/src/loops/merge-gate.ts`: pure `mergeGate(ticket, pr, loop, base)` returning `{ action: 'merge' | 'mark-ready' | 'update-branch' | 'fix' | 'wait' | 'visual-review' | 'blocked', sha? }`:
  - `changements` on the head → `fix` (Code StepRun `mode: fix-review`, `loopStep: fixing`) while `reviewRounds < 3`; the third `changements` → `blocked`.
  - `ok` and the PR still a draft → `mark-ready` (`loopStep: waiting-checks`).
  - checks `failed` on the head → `fix` (`mode: fix-ci`) while `ciFixAttempts < 3`, else `blocked`.
  - the PR behind its base (`compareCommits(base, sha).behindBy > 0`) → `update-branch`; a conflict (GitHub 422) → `fix` (`mode: fix-conflict`).
  - review `ok`, Code Contrat passed and checks `passed`, all on the head SHA, PR open and not a draft, the Boucle `running` → `merge` with that SHA, unless `requiresVisualReview(ticket)` (a hook returning false until BOUCLE-6) → `visual-review`.
  - anything else → `wait`.
  Evaluated on every `ticket.upserted` of a Ticket with a `loopStep` and after each StepRun.
- `apps/server/src/loops/merger.ts`: `LoopMerger.merge(ticket, sha)`: `GitHubClient.merge(squash, sha)`; a 405/409 from GitHub (head moved) is not an error: the verdicts are void and the gate runs again. Success: `mergedBy: loop` comes back with BOUCLE-1's webhook; `LoopRecord.outcome: merged-by-loop`, `endedAt`; `loopStep` cleared; the scheduler `tick`. Reused by BOUCLE-6.
- New `GitHubClient` methods (and in the fake GitHub): `markPullRequestReady`, `updatePullRequestBranch(expectedHeadSha)`, `compareCommits`.
- A new head (`pull_request.synchronize`) voids `reviewVerdict`, `reviewSha`, `codeContractSha`; a push by the Code Session in `fixing` goes back to `in-review`; any other push (the Pilote, on GitHub) too, and sets `LoopRecord.pilotIntervened`.
- An update-branch merge commit made by Crewdeck carries the verdicts from the old SHA to the new one (`Ticket.reviewSha` and `codeContractSha` moved, a row `VerdictCarry { ticketId, fromSha, toSha }`), as `agent-loop`'s « Base fusionnée, approbation conservée »; the checks must pass again on the new SHA.
- `blocked` raises `ticket-blocked` (`DecisionsService.raise`, label « #<n> <titre> » (the kind « Ticket bloqué » is rendered by ATOI-1), meta « <Projet> · Review · 3 passages sans accord » or « … · Checks en échec »), adds the label `needs-human`, `loopStep: blocked`, `LoopRecord.blockedCount + 1`; the Boucle goes on with the Tickets that do not depend on it.
- A PR merged or closed by the Pilote on GitHub ends the `LoopRecord` (`merged-by-pilot` or `closed`, `pilotIntervened: true`).
- Skill `code`: fill the modes `fix-review` (read the last review on the PR, fix or answer each remark as a reply), `fix-ci` (read the failed checks' logs with the Session's token), `fix-conflict` (merge the base, resolve, push), from the `agent-loop` prompts.

## Decisions already made

- The verdict that lets the Boucle merge is Crewdeck's; a bot cannot approve its own PR, so the Review posts a `COMMENT` review (ADR 0002).
- Three rounds of review without `ok`, or three red CI fixes, block the Ticket (`agent-loop`'s `AGENT_LOOP_MAX_ROUNDS`).
- Squash merge, commit title `<titre de la PR> (#<pr>)`, through the merge API with `sha`.
- The Review's Moteur and model are the effective `roles.review`; the default « another Moteur than the Code » is PARAM-2's, not decided here.
- The Boucle never merges while it is `stopped`; the gate answers `wait`.

## Acceptance criteria

- [ ] After a passed Code verdict, a Review StepRun starts on the head SHA with `roles.review`'s Moteur; its `ok` marks the PR ready (`waiting-checks`), its `changements` starts a `fix-review` Code StepRun.
- [ ] With review `ok`, Code Contrat passed and checks passed on SHA `a1…`, the server merges with `sha: a1…`; if the head is `b2…`, it does not merge.
- [ ] A push after the verdict voids it and a new Review runs on the new head (integration test with the fake GitHub).
- [ ] GitHub refusing the merge because the head moved leaves the Ticket in the gate, without a 500.
- [ ] A PR behind its base gets `updatePullRequestBranch`; the verdicts carry to the new SHA and the merge waits for its checks.
- [ ] The third `changements` (or third red CI) raises « Ticket bloqué », labels `needs-human`, and the Boucle takes a ready Ticket that does not depend on it.
- [ ] `mergeGate` has a unit test per branch above; the Review Contrat's rules pass and fail their fixtures with their ids.
- [ ] Each change of the Ticket writes its `ticket.upserted` event in the same transaction.

## Verification

- `pnpm exec nx test server -- src/loops/merge-gate.spec.ts`
- `pnpm exec nx test server -- src/loops/`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- loops`
- `pnpm exec nx test contracts -- src/contrats/review.spec.ts`
- `cd apps/runner && go test ./internal/contrat/...`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

A migration (columns of `tickets`, table `verdict_carries`). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- The Ticket's page showing the review and checks: BOUCLE-5. The agent's own blocked report and the Pilote's answer: BOUCLE-5.
- `requiresVisualReview` and the visual review: BOUCLE-6.
- A limit or a disconnection during the Review: BOUCLE-7.

## Dependencies

- BOUCLE-3
