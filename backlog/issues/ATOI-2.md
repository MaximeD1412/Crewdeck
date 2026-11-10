---
id: ATOI-2
title: "« Contrat incomplet » and « Étape échouée »: every Étape that misses its Contrat or fails raises a Décision to run it again"
epic: ATOI
type: feature
priority: P0
size: S
milestone: M3 Sessions and preparing Projets
blocked_by: [RUNNER-11, RUNNER-9, RUNNER-12, ATOI-1]
adr: [0005, 0007, 0008]
risques: [IA-6]
stories: [US-48]
screens: []
revue_visuelle: false
video: false
---

## Context

US-48: the output of every Étape is checked against its Contrat, and a Décision in « À toi » runs it again when it is incomplete or fails. ADR 0005: an `incomplete` verdict raises « Contrat incomplet » (the failed rules' labels, « Relancer l'Étape »); a Session that ends in error or is stopped by the Runner raises « Étape échouée » (same action). This ticket does it once for every Étape: the Idée analysis (IDEE-2), the Inventaire (PROJET-4), the Code (BOUCLE-3), the Conception's Étapes (CONCEPTION-3 to CONCEPTION-9) rely on it. Keeping an Idée whose analysis failed open to triage is IDEE-2's.

## Current state of the code

- Only documents: `docs/adr/0005-contrats-as-data.md`, the mockup row « Contrat incomplet · Découpage « Actualités » » in `design/screens/crewdeck/a-toi.html`.
- Created by RUNNER-11: the Contrat declarations (`packages/contracts/src/contrats/<step>.ts`, each rule with its id and French label), the `step.verdict` message (`{ stepRunId, contractId, version, status: 'passed' | 'incomplete', failedRuleIds, headSha? }`).
- Created by RUNNER-9: `AgentSession` and its end (`ended` with an error, or stopped by the Runner).
- Created by RUNNER-12: `StepRun` and `StepsService` (`apps/server/src/steps/`): a verdict sets `passed` or `incomplete`, a Session ended in error or stopped by the Runner sets `failed` with `failure: 'session-error' | 'session-stopped'`, and the in-process hook `step-run.finished(stepRun)` is emitted in that transaction.
- Created by ATOI-1: `DecisionsService.raise/resolve/assertOpen`, the kinds `contract-incomplete` and `step-failed`, `apps/web/src/views/decisions/registry.ts`.

## To do

- **Server** `apps/server/src/steps/step-decisions.ts`, a handler of `step-run.finished` for every Étape:
  - verdict `incomplete` → `raise` kind `contract-incomplete`, `subjectType: 'step-run'`, `subjectId` = the StepRun's id, tone caution, `label` = « <Étape> « <subject title> » » (the Étape's label from `t('step.<id>')`'s server copy in `packages/contracts/src/contrats/labels.ts`, the subject's readable title: a Conception's title, a Ticket's « #n title », a Projet's name; an Idée's is never readable: « Analyse d'une Idée »), `metaParts` « <Projet> · <Étape> », `params { stepRunId, failedRuleIds (comma-separated), failedCount }`, `link` the subject's page;
  - status `failed` → `raise` kind `step-failed`, same fields, `params { stepRunId, failure }` (`session-error` or `session-stopped`; a Session stopped by the Pilote is not a failure for RUNNER-12);
  - a later `passed` verdict on the same subject and step, or a rerun → `resolve(…, 'rerun' | 'passed')`.
- **Route** `POST /api/step-runs/:id/rerun { seq }` (`apps/server/src/steps/step-runs.controller.ts`): the StepRun must be `incomplete` or `failed` (else 422 `step.not-rerunnable` « Cette Étape ne peut pas être relancée. »); `assertOpen` on its Décision (409 `decision.already-answered`); stale `seq` → 409 `realtime.stale`; creates a new StepRun for the same step, subject and Rôle through `StepsService.start`, resolves the Décision with outcome `rerun`, returns the new StepRun. 404 for another Pilote's. Runner offline: the new StepRun is `queued` (RUNNER-12) and runs when it is back.
- **Contract** `packages/contracts/src/api/step-runs.ts`: the rerun body and response.
- **Page**: `apps/web/src/views/decisions/contract-incomplete.ts` and `step-failed.ts` registered in the kinds registry: context « <label of the first failed rule> » plus « et <n> autres » when there are more (labels read from the same Contrat declarations, `packages/contracts/src/contrats/`), « La session s'est arrêtée en erreur. » / « Le Runner a arrêté la session. » for `step-failed`; actions « Relancer l'Étape » (primary, `needsRunner: false`) → `apps/web/src/api/step-runs.ts` `rerun(id, seq)`, and « Voir » → `link`.
- t() keys `decision.contractIncomplete.*`, `decision.stepFailed.*`, `step.*` (the nine Étape labels: « Analyse d'une Idée », « Inventaire », « PRD », « Maquettes », « Conception technique », « Revue croisée », « Découpage », « Code », « Review »).

## Decisions already made

- One Décision per StepRun; the content never travels: only rule ids and their labels from the declarations, the same in the server and the page (ADR 0005).
- A Session stopped by the Pilote is not a failure: no Décision.
- Rerun always starts a fresh StepRun (and a fresh Session); the old StepRun stays for the history and the statistics (PILOTAGE-3 counts reruns).
- The module of the Étape keeps its own reaction (an Idée stays open to triage, a Ticket stays `coding`): this ticket only raises, resolves and reruns.

## Acceptance criteria

- [ ] An `incomplete` verdict raises one « Contrat incomplet » with the first failed rule's label and the count of the others, in « À toi » within 2 s.
- [ ] A Session ending in error raises « Étape échouée »; a Session stopped by the Pilote raises nothing.
- [ ] « Relancer l'Étape » starts a new StepRun of the same Étape and removes the Décision; a second click gets 409 `decision.already-answered`.
- [ ] Rerunning a `passed` StepRun gives 422 `step.not-rerunnable`; another Pilote's gives 404; a stale `seq` 409.
- [ ] A later `passed` verdict on the same subject resolves an open « Contrat incomplet ».
- [ ] The Décision row holds no content: only ids, the Étape's label and the subject's readable title (test on the stored row).

## Verification

- `pnpm exec nx test server -- src/steps/step-decisions.spec.ts`
- `pnpm exec nx test-integration server -- step-runs`
- `pnpm exec nx test web -- src/views/decisions/contract-incomplete.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

Nothing.

## Out of scope

- The Contrat of each Étape: its own ticket (IDEE-2, PROJET-4, BOUCLE-3, BOUCLE-4, CONCEPTION-3 to CONCEPTION-9).
- The « Contrat incomplet » state of a Conception's page: CONCEPTION-2.

## Dependencies

- RUNNER-11
- RUNNER-9
- RUNNER-12
- ATOI-1
