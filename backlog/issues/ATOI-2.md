---
id: ATOI-2
title: "« Contrat incomplet » and « Étape échouée »: every agent Étape that misses its Contrat or fails raises a Décision to run it again"
epic: ATOI
type: feature
priority: P0
size: S
milestone: M3 Sessions and preparing Projets
blocked_by: [RUNNER-11, RUNNER-9, RUNNER-12, ATOI-1, PROCESS-4]
adr: [0005, 0007, 0008, 0011]
risques: [IA-6]
stories: [US-48]
screens: []
revue_visuelle: false
video: false
reprend: 51
---

## Context

US-48: the output of every Étape is checked against its Contrat, and a Décision in « À toi » runs it again when it is incomplete or fails. ADR 0005: an `incomplete` verdict raises « Contrat incomplet » (the failed rules' labels, « Relancer l'Étape »); a Session that ends in error or is stopped by the Runner raises « Étape échouée » (same action). This ticket does it once for every agent Étape: the Idée analysis (IDEE-2), the Inventaire (PROJET-4), the Code (BOUCLE-3), the Review (BOUCLE-4), the Conception's Étapes (CONCEPTION-3 to CONCEPTION-9) rely on it. Keeping an Idée whose analysis failed open to triage is IDEE-2's.

The refonte (PRD #169, ADR 0011) moves where a run of an Étape lives: a StepRun is a pass of an Étape of a PhaseRun, pinned to its version, in PROCESS-4's `step_runs`, and its agent kinds finish through RUNNER-12's `StepRunHooks.onFinished`. So the Décision names the Étape by its name in the pinned definition (the Pilote may have renamed it), and « Relancer l'Étape » is the engine's `retry`: a new StepRun of the same Étape and iteration in the same PhaseRun, the PhaseRun going on from there. There is no `steps` module nor `StepsService` any more. A Commande that fails raises its own Décision (`command.failed`, PROCESS-12), and a « changements » Verdict is a Retour (PROCESS-6), not a failure.

## Current state of the code

- `packages/contracts/src/contrats/` (RUNNER-11, merged): the Contrat declarations' registry (`index.ts`, each rule with its id and French `label`), `zVerdict` (`status: 'passed' | 'incomplete'`, `failedRuleIds`); `packages/contracts/src/runner/step.ts`: `step.verdict { stepRunId, verdict }`.
- `apps/server/src/decisions/decisions.service.ts` (ATOI-1, merged): `raise(tx, input)` (one open per `(kind, subjectId)`), `resolve(tx, kind, subjectId, outcome)`, `assertOpen`; `DECISION_KINDS` has `contract-incomplete` and `step-failed`; `apps/web/src/views/decisions/registry.ts` (`registerDecisionView`, `DecisionAction` with `needsRunner`). `withSeq`, 409 `realtime.stale` (CORE-7).
- Created by RUNNER-9: `AgentSession` and its end (`ended` with `outcome: 'error'`, or stopped by the Runner).
- Created by PROCESS-4: `apps/server/src/process/engine/` (`Engine.retry(tx, stepRunId)`: a `failed` StepRun gets a new StepRun of the same Étape and iteration, its PhaseRun `running` again), `step_runs` (`state`, `failure`, `contratVerdict`, `phaseRunId`, `stepId`, `kind`), the events `step-run.upserted`, `phase-run.upserted`; `phase_runs` (`projectId`, `phaseId`, `itemType`, `itemId`, the pinned definition).
- Created by RUNNER-12: `StepRunHooks.onFinished(tx, stepRun, { status: 'passed' | 'incomplete' | 'failed', verdict?, failure? })` for every agent kind, `failure` `session-error` or `session-stopped`, `contract-incomplete` for an `incomplete` verdict.

## To do

- **Server** `apps/server/src/process/engine/step-decisions.ts`, a handler of `StepRunHooks.onFinished`:
  - `incomplete` → `raise` kind `contract-incomplete`, `subjectType: 'step-run'`, `subjectId` the StepRun's id, tone caution, `label` the Étape's `name` in the PhaseRun's pinned definition, then « · » and the item's label from `ItemLabels` when it has one, `projectId` the PhaseRun's, `metaParts` [the Phase's name], `params { stepRunId, phaseRunId, stepId, itemType, itemId, failedRuleIds (comma-separated), failedCount }`, `link` the item's page from `ItemLabels`, else `/projets/<projectId>`;
  - `failed` with `failure` `session-error` or `session-stopped` → `raise` kind `step-failed`, the same fields, `params { stepRunId, phaseRunId, stepId, itemType, itemId, failure }`; any other `failure` (`no-handler`…) raises nothing (a bug, logged with its code);
  - `passed` on a StepRun of the same PhaseRun and Étape → `resolve` of an open Décision of the earlier StepRun with `passed`.
- **Item labels** `apps/server/src/process/engine/item-labels.ts`: `registerItemLabel(itemType, (tx, itemId) => Promise<{ label: string | null, link: string }>)`, one per item type; a type nobody registered gives `{ label: null, link: '/projets/<projectId>' }`. This ticket registers `project` (`label: null`, `link: /projets/<id>`); the item modules register theirs (BOUCLE-1's Tickets « #<n> » plus the readable GitHub title, an Idée never readable: `null`, a Conception CONCEPTION-1). A label is never a sealed text.
- **Route** `POST /api/step-runs/:id/rerun { seq }` (`apps/server/src/process/engine/step-runs.controller.ts`): the StepRun must be `failed` with `failure` `contract-incomplete`, `session-error` or `session-stopped` (else 422 `step.not-rerunnable` « Cette Étape ne peut pas être relancée. »); `assertOpen` on its Décision (409 `decision.already-answered`); stale `seq` → 409 `realtime.stale`; `Engine.retry(tx, id)`, then `resolve(…, 'rerun')` in the same transaction; returns the new `zStepRun`. 404 `step-run.not-found` for an unknown or another Pilote's. The Runner offline: the new StepRun's Session stays `starting` (RUNNER-9) and starts when it is back, so the action does not need the Runner. French messages in `apps/server/src/errors/messages.ts`.
- **Contract** `packages/contracts/src/api/step-runs.ts`: the rerun body (`withSeq({})`) and response (`zStepRun`, PROCESS-4's).
- **Page**: `apps/web/src/views/decisions/contract-incomplete.ts` and `step-failed.ts` registered with `registerDecisionView`: title the Décision's label, the item's title opened by the page when its label is `null` and its module gives one in the store (a Local Ticket's sealed title, BOUCLE-1, SOURCE-3); context « <label of the first failed rule> » plus « et <n> autres » when there are more (labels read from the same Contrat declarations, `packages/contracts/src/contrats/`), « La session s'est arrêtée en erreur. » / « Le Runner a arrêté la session. » for `step-failed`; actions « Relancer l'Étape » (primary, `needsRunner: false`) → `apps/web/src/api/step-runs.ts` `rerun(id, seq)`, and « Voir » → `link`.
- t() keys `decision.contractIncomplete.*`, `decision.stepFailed.*` in `packages/sdk/src/i18n/fr.ts`.

## Decisions already made

- One Décision per StepRun; the content never travels: only rule ids and their labels from the declarations, the same in the server and the page (ADR 0005), the Étape's and Phase's names from the pinned definition (configuration the server reads, ADR 0011).
- A Session stopped by the Pilote is not a failure (RUNNER-12 gives it no `failed`): no Décision.
- Rerun is `Engine.retry`: a fresh StepRun (and a fresh Session) of the same Étape and iteration, on the PhaseRun's pinned version; the old StepRun stays for the history and the statistics (PILOTAGE-3 counts reruns). It counts against no Retour.
- Only the agent family raises these two Décisions: a gate never fails, a Commande raises `command.failed` (PROCESS-12), `checks` gives a failed Verdict (BOUCLE-9), and a Retour's maximum is `loop-back.exhausted` (PROCESS-6).
- The module of the item keeps its own reaction (an Idée stays open to triage, an Inventaire stays `drafting`): this ticket only raises, resolves and reruns.

## Acceptance criteria

- [ ] An `incomplete` verdict raises one « Contrat incomplet » labelled with the Étape's name of the pinned definition, the first failed rule's label and the count of the others, in « À toi » within 2 s.
- [ ] An Étape renamed « Code du front » in the Projet's version shows that name in its Décision.
- [ ] A Session ending in error raises « Étape échouée »; a Session stopped by the Pilote raises nothing; a StepRun `failed` with `no-handler` raises nothing.
- [ ] « Relancer l'Étape » creates a new StepRun of the same Étape and iteration in the same PhaseRun (`Engine.retry`), the Décision leaves « À toi »; a second click gets 409 `decision.already-answered`.
- [ ] Rerunning a `done` StepRun gives 422 `step.not-rerunnable`; another Pilote's gives 404; a stale `seq` 409.
- [ ] A later `passed` StepRun of the same PhaseRun and Étape resolves an open « Contrat incomplet ».
- [ ] The Décision row holds no content: only ids, the Étape's and Phase's names and a readable item label (test on the stored row; a Local item's label is `null`).

## Verification

- `pnpm exec nx test server -- src/process/engine/step-decisions.spec.ts`
- `pnpm exec nx test-integration server -- step-runs`
- `pnpm exec nx test web -- src/views/decisions/contract-incomplete.spec.ts src/views/decisions/step-failed.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

Nothing.

## Out of scope

- The Contrat of each Étape: its own ticket (IDEE-2, PROJET-4, BOUCLE-3, BOUCLE-4, CONCEPTION-3 to CONCEPTION-9).
- The « Contrat incomplet » state of a Conception's page: CONCEPTION-2. A Commande's failure: PROCESS-12. A Retour's maximum: PROCESS-6.

## Dependencies

- RUNNER-11
- RUNNER-9
- RUNNER-12
- ATOI-1
- PROCESS-4
