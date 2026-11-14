---
id: BOUCLE-4
title: "The review and merge kinds: a Review on its own Rôle, and the merge at the SHA every Verdict judged, on GitHub or Local"
epic: BOUCLE
type: feature
priority: P0
size: M
milestone: M4 Boucle
blocked_by: [BOUCLE-3, SOURCE-5]
adr: [0002, 0004, 0005, 0009, 0011, 0012]
risques: [IA-5, AGT-2]
stories: [US-15, US-39]
screens: []
revue_visuelle: false
video: false
reprend: 65
---

## Context

US-15: each **Ticket** is delivered as a **Changement de code** that the **Review** and the checks judge, and that the **Boucle** merges itself once they pass. Nobody reads the code before the merge (risks IA-5, AGT-2), so the merge is bound to the commit every **Verdict** judged (ADR 0002): on GitHub the SHA goes to the merge API, which refuses it if the head moved; on a Local Projet the Runner squashes that SHA in its clone and fast-forwards the folder (ADR 0012, SOURCE-5). Per ADR 0011 the Review and the Merge are two kind handlers of PROCESS-4's engine: `review` (an agent Étape that judges, on the Rôle of its `role` Outil, by default another **Moteur** than the Code, US-39) and `merge` (an **Étape du produit**, never removed). A Review's « changements » takes the Phase's **Retour** (PROCESS-6); the checks are BOUCLE-9's `checks` kind. Source of the Skill: the founder's `agent-loop` steps 3 and 4.

## Current state of the code

- `apps/server/src/github/github.client.ts`: `getPullRequest`, `mergePullRequest(repo, number, { sha, method: 'squash' | 'merge' })`, `mergeBranch`, `addLabels`, `removeLabel`, `createIssueComment`; no `updatePullRequestBranch` nor `compareCommits`. Error `github.head-moved` (« La PR a changé depuis la dernière vérification. ») in `apps/server/src/errors/messages.ts`. The fake GitHub `apps/server/src/testing/fake-github.ts`.
- `packages/contracts/src/api/decisions.ts`: `DECISION_KINDS` (`step-failed`, `contract-incomplete`…); `apps/server/src/decisions/decisions.service.ts`: `raise(tx, …)`, `resolve`.
- Created by BOUCLE-3: the `code` handler (output `code-change` at the reported SHA, its modes), the Code Contrat, the Skill `apps/runner/skills/code/SKILL.md` with its « Modes ». Created by BOUCLE-2: `AgentLoop` (`state`), `LoopRecord` (`outcome`, `pilotIntervened`), the slot. Created by BOUCLE-1: `CodeChange` (`source`, `number`, `ticketNumber`, `headRef`, `baseRef`, `headSha`, `state`, `mergedAt`, `mergeSha`, `mergedBy`), its GitHub webhooks and Local rows.
- Created by PROCESS-1: kinds `review` (judges; Entrées `code-change`, `verdict`; Sortie `verdict`) and `merge` (core; Entrées `code-change` and Verdicts; Sortie `code-change`). Created by PROCESS-4: the kind registry, `step_runs` (`verdict`, `outputs`), the feeding; PROCESS-5: Sorties feeding a Phase without `forEach` (the « Livraison »); PROCESS-6: Retours and `loop-back.exhausted`.
- Created by SOURCE-5: protocol `merge.local { projectId, changeNumber, sha }` and its answer (`merge.local.result`: `merged { sha } | conflict | blocked | stale`, `stale` when the head moved, handled as `github.head-moved`), Décision `merge.local-blocked`. Created by MIROIR-7: `miroir pr review|comment` for both Sources. Created by RUNNER-12: `defineAgentKind`, `registerStepReport`, `crewdeck-runner etape report`. Created by BOUCLE-9: the `checks` kind and its Verdict, read by the Review through its Entrée.
- Sources of the Skill: dotfiles repository `MaximeD1412/dotfiles`, `agents/tools/agent-loop/prompts/review.md`, `review-followup.md`, `review-schema.json`, `fix-conflict.md`.

## To do

- **`review` kind** `apps/server/src/process/engine/kinds/review.ts`, defined with RUNNER-12's `defineAgentKind`: the Session's input `{ changeNumber, sha, verdicts: [{ stepId, kind, value }] }` (the Verdicts its Entrées received, such as the checks'); its report handler (`registerStepReport('review', …)`) stores `StepRun.verdict = { value: 'ok' | 'changements', sha, remarkCount }` and the output `{ portId, type: 'verdict', id: stepRun.id, sha }`. « changements » is handed to PROCESS-6 (Retour, or the stop without one).
- Skill `apps/runner/skills/review/SKILL.md` (from `review.md` and `review-followup.md`): read the change with `crewdeck-runner miroir pr view <n> --json title,body,headRefOid,commits,reviews,statusCheckRollup` and its diff in the worktree; judge it against the Ticket and the conventions file; a failed Verdict among its Entrées is a « changements » with the remark « Checks en échec : <noms> »; post one review with `miroir pr review <n> --comment --body-file …` (remarks `file:line — titre`, or general); write `.crewdeck/review.json` (`{ verdict, headSha, remarks: [{ severity, file?, line?, general?, title }] }`); end with `crewdeck-runner etape report` (`verdict`, `headSha`, `remarkCount`). A follow-up review reads its previous review and judges what changed since.
- Contrat `packages/contracts/src/contrats/review.ts`: `review.verdict` (`json`: `verdict` `ok | changements`, `headSha` 40 hex), `review.remarks.located` (`check` `remarks-located`: each remark has `file` and `line`, or `general: true`), `review.honours-inputs` (`check` `honours-inputs`: no `ok` when a Verdict Entrée failed, read from `.crewdeck/inputs.json` the Runner writes), `review.posted` (`pr`: a review by the Session's author on `headSha`, read through the Miroir). French labels, Go functions in `apps/runner/internal/contrat/checks/`, fixtures passing and failing.
- **`merge` kind** `apps/server/src/process/engine/kinds/merge.ts`:
  - `apps/server/src/process/engine/judged-verdicts.ts`: pure `judgedVerdicts(definition, stepRuns, mergeStepId)`: the latest Verdict of every judging or `checks` Étape from which an arrow path reaches the Merge (the Checks through the Review in « Process Crewdeck »).
  - `apps/server/src/loops/merge-gate.ts`: pure `mergeGate({ change, verdicts, codeContract, loop, confirmedSha?, behindBy })` → `{ action: 'merge' | 'update-branch' | 'wait', sha? }`: `merge` when every judged Verdict passed on `change.headSha`, the Code Contrat's verdict passed on it, the change open, and the Boucle `running` or `confirmedSha === headSha` (BOUCLE-6's confirmed approval); `update-branch` when a GitHub change is behind its base (`compareCommits(base, sha).behindBy > 0`); else `wait`. Evaluated in `start` and on every `onSignal` (a new head, a Verdict, the Boucle started).
  - Merge, by Source: GitHub `mergePullRequest(repo, number, { sha, method: 'squash' })`, commit title `<titre> (#<pr>)`, a refusal because the head moved (`github.head-moved`) re-enters the gate without a 500; Local `RunnerCommands.send(pilotId, merge.local { projectId, changeNumber, sha })`, `blocked` left to SOURCE-5's Décision and retry. Success: output `{ portId, type: 'code-change', id, sha: mergeSha }` (fed to the next Phase by PROCESS-5), the PhaseRun `done`, `LoopRecord.outcome: merged-by-loop`, BOUCLE-2's tick.
  - A conflict (GitHub 422 on update-branch, `mergeable: false`; Local `conflict`) reruns from the Étape that produced the change, in `mode: fix-conflict`, through PROCESS-6's rerun (`iteration + 1`, not counted against a Retour's maximum); the third conflict of a PhaseRun fails the Merge StepRun (ATOI-2's « Étape échouée »).
- A new head on the change (GitHub `pull_request.synchronize`, Local `local.changed` moving its branch) that no Code StepRun of the PhaseRun reported and that is not Crewdeck's update-branch: the Code StepRun gets a new `code-change` output at that SHA (the engine feeds its Étapes again), `LoopRecord.pilotIntervened: true`.
- An update-branch merge commit made by Crewdeck carries the Review's and the Code Contrat's verdicts from the old SHA to the new one (`VerdictCarry { codeChangeId, fromSha, toSha }`), as `agent-loop`'s « Base fusionnée, approbation conservée »; the checks judge the new SHA again (BOUCLE-9).
- A change merged by the Pilote at its Source ends the PhaseRun (`done`, `outcome: merged-by-pilot`, `pilotIntervened`); a change closed by the Pilote while its Ticket stays open stops it (`stopped`, `outcome: closed`).
- `GitHubClient` (and the fake): `updatePullRequestBranch(repo, number, expectedHeadSha)`, `compareCommits(repo, base, head)`.
- Skill `code`: fill the mode `fix-conflict` from `fix-conflict.md` (merge the base in the worktree, resolve, push).

## Decisions already made

- The Verdict that lets the Boucle merge is Crewdeck's: a bot cannot approve its own PR, so the Review posts a `COMMENT` review (ADR 0002); on Local it is a record of `local.db` (MIROIR-7).
- Which Verdicts the Merge needs is read from the pinned definition (`judgedVerdicts`), never from a list of kinds: a second Review on Gemini added to the Process is waited for like the first.
- Squash merge on both Sources.
- The Review's Moteur and model are its Rôle's effective ones; the default « another Moteur than the Code » is PARAM-2's.
- The Boucle never merges while `stopped`: the gate answers `wait`, except a merge the Pilote confirmed as an Action sensible (BOUCLE-6).
- The number of Review rounds is the Retour's maximum (PROCESS-6), no longer a constant here.

## Acceptance criteria

- [ ] After the Code's output, a Review StepRun starts on its SHA with its Rôle's Moteur; `ok` gives a Verdict output; `changements` takes the Retour to the Code (PROCESS-6).
- [ ] A failed checks Verdict among the Review's Entrées makes `review.honours-inputs` fail an `ok`.
- [ ] With every judged Verdict and the Code Contrat passed on SHA `a1…`, a GitHub change is merged with `sha: a1…`; if the head is `b2…`, nothing is merged; the same on a Local Projet sends `merge.local` with `a1…` (fake Runner).
- [ ] A push by the Pilote after the Verdicts feeds the Étapes again on the new head and sets `pilotIntervened` (integration test with the fake GitHub).
- [ ] GitHub refusing the merge because the head moved leaves the Merge in its gate, without a 500.
- [ ] A GitHub change behind its base gets `updatePullRequestBranch`; the verdicts carry to the new SHA and the merge waits for the checks on it.
- [ ] A conflict reruns the Code Étape in `fix-conflict`; the third one fails the Merge StepRun.
- [ ] A Process with a second `review` Étape reaching the Merge waits for both Verdicts (`judgedVerdicts` and `mergeGate` unit tests, one per branch).
- [ ] The merge ends the PhaseRun and its LoopRecord (`merged-by-loop`), and the Boucle admits its next Ticket; each change writes its event in the same transaction.
- [ ] The Review Contrat's rules pass and fail their fixtures with their ids.

## Verification

- `pnpm exec nx test server -- src/loops/merge-gate.spec.ts`
- `pnpm exec nx test server -- src/process/engine/kinds/`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- loops`
- `pnpm exec nx test contracts -- src/contrats/review.spec.ts`
- `cd apps/runner && go test ./internal/contrat/...`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

A migration (table `verdict_carries`). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- The `checks` kind (CI or Commandes): BOUCLE-9. Retours, their maximum and `loop-back.exhausted`: PROCESS-6.
- The local merge itself and `merge.local-blocked`: SOURCE-5. A Ticket closed at its Source: SOURCE-6.
- The Ticket's page and the agent's blocked report: BOUCLE-5. The visual review: BOUCLE-6.
- A limit or a disconnection during the Review: BOUCLE-7. The « Livraison » after the merge: PROCESS-13.

## Dependencies

- BOUCLE-3
- SOURCE-5
