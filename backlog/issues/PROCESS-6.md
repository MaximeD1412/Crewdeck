---
id: PROCESS-6
title: "Retours: a Verdict « changements » sends the work back, up to its maximum, then « Maximum de Retours atteint » offers one more pass or to stop"
epic: PROCESS
type: feature
priority: P1
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [PROCESS-4]
adr: [0011]
risques: [AGT-9]
stories: [US-95]
screens: [a-toi-process]
revue_visuelle: true
video: false
---

## Context

US-95: a Retour goes from an Étape that judges to an earlier Étape of its Phase, with a maximum of iterations (3 by default); reaching it stops that item with a Décision that offers one more pass or to stop it (the Ticket closed, the Conception abandoned), with its Session to read. ADR 0011, « A Retour »: a Verdict « changements » of the Étape a Retour leaves runs the StepRuns from its target on again, `iteration` + 1; once the PhaseRun has taken it `max` times the item stops on the Décision `loop-back.exhausted` (« Encore un passage » allows one more, « Arrêter » stops); an Étape that judges without a Retour cannot ask for changes (its « Demander des changements » is hidden), and a Review's « changements » without a Retour stops the item on the same Décision without « Encore un passage ». Risk AGT-9: no loop runs without end. The Review (BOUCLE-4), the Revues croisées (CONCEPTION-8), the Revue visuelle (BOUCLE-6) and the approvals (CONCEPTION-4, 6, 10) give their Verdict through `Engine.signal`; this ticket takes the Retour.

## Current state of the code

- Created by PROCESS-4: `apps/server/src/process/engine/` (`Engine.signal`, `stop`, `supersedeFrom`, `rerunFrom`, `advance`; `StepResult` with `verdict` `passed | changes | failed`), `step_runs` (`iteration`, `reason`, state `superseded`), `phase_runs` (`waitingOn` with `decision`), the slices `phaseRuns` and `stepRuns`; by PROCESS-1 and PROCESS-2: `CATALOGUE[kind].judges`, `zLoopBack { from, to, max }`, the Retours of « Process Crewdeck », `loop-back.*` refusals.
- `packages/contracts/src/api/decisions.ts`: `DECISION_KINDS` (no `loop-back.exhausted`); `apps/server/src/decisions/decisions.service.ts`: `raise(tx, …)` (one open per `(kind, subjectId)`), `resolve(tx, kind, subjectId, outcome)`, `assertOpen(tx, id)` (404 `decision.not-found`, 409 `decision.already-answered`).
- `apps/web/src/views/decisions/registry.ts`: `registerDecisionView(kind, { title?, context?, actions })`, `DecisionAction { id, label, primary?, needsRunner?, run }`, `OPEN_ACTION`; `apps/web/src/views/a-toi.ts`: `ICONS: Record<DecisionKind, IconName>`.
- `packages/contracts/src/composants/icons.ts`: no `undo` (the mockup's icon, drawn in `design/components.js`); `packages/sdk/src/i18n/fr.ts`: `decision.kind.<kind>` labels.
- Scenarios `apps/server/src/testing/scenarios/` (`a-toi.ts` seeds Décisions with `prisma.unscoped`), e2e `apps/web/e2e/a-toi.spec.ts`.

## To do

- **Contracts**:
  - `DECISION_KINDS` gains `loop-back.exhausted`; `packages/contracts/src/process/loop-backs.ts`: `loopBackFrom(definition, stepId): LoopBack | null`, `canAskChanges(definition, stepId)` (the Étape judges and a Retour leaves it).
  - `zPhaseRun` gains `loopBacks: { from, to, taken, extra }[]`; `zStepRun` gains `canAskChanges: boolean`.
  - `packages/contracts/src/api/phase-runs.ts`: `zPhaseRunDecisionAnswer { decisionId }`.
  - `ICON_NAMES` gains `undo` (and `packages/skin-passerelle/src/icons.ts` its path from `design/components.js`), if UI-8 or UI-9 has not added it.
- **Prisma** (migration `<date>_loop_backs`): `phase_runs.loopBacks` jsonb default `[]`.
- **Server** `apps/server/src/process/engine/`:
  - `loop-backs.ts`, called by `Engine.signal` when a result is `done` with `verdict: 'changes'`, the definition being the PhaseRun's Version's:
    - a Retour leaves the Étape and `taken < max + extra`: `taken` + 1, `supersedeFrom(tx, phaseRun, retour.to)` (the target and every Étape it reaches inside the Phase, running ones stopped through their handler), a new StepRun of the target at its last iteration + 1, `reason: 'loop-back'`, then `advance`;
    - a Retour leaves it and `taken = max + extra`: the PhaseRun `waiting`, `waitingOn: 'decision'`, and `DecisionsService.raise` `loop-back.exhausted`, subject `phase-run` / the PhaseRun's id, tone `caution`, label from the item (below), `metaParts: [<Étape's name>]`, `params { phaseRunId, stepRunId, stepName, targetName, taken, max, canContinue: true, sessionId }`, link `/a-toi?session=<sessionId>` (or `/a-toi` without one);
    - no Retour leaves it: the same Décision with `canContinue: false`, `targetName: null`;
    - a gate (`family: 'gate'`) whose Étape has no Retour signalling `changes`: 422 `step-run.no-loop-back` (the gate's command was not offered).
    - `sessionId`: the judging StepRun's Session, else the Retour target's last StepRun's, else `null`.
  - `items.ts`: `PHASE_ITEMS` (`Registry<PhaseItemHandler>`), `PhaseItemHandler { itemType, label(tx, itemId): Promise<string>, onStopped(tx, phaseRun): Promise<void> }`; without one, the label is « <Phase's name> · <type's label> » and stopping does nothing more.
  - `phase-runs.controller.ts`:
    - `POST /api/phase-runs/:id/one-more-pass { decisionId }`: `assertOpen`, the Décision `loop-back.exhausted` of that PhaseRun with `canContinue` (else 422 `phase-run.no-loop-back`); `extra` + 1, the Retour taken at once as above, the Décision resolved `one-more-pass`, the PhaseRun `running`;
    - `POST /api/phase-runs/:id/stop { decisionId }`: `assertOpen`; `Engine.stop`, then the item's `onStopped` (the Ticket closed at its Source, the Conception abandoned), the Décision resolved `stopped`;
    - 404 `phase-run.not-found` for an unknown or another Pilote's PhaseRun; one transaction each, with their events.
  - `messages.ts`: `'phase-run.not-found': 'Ce travail n’existe pas.'`, `'phase-run.no-loop-back': 'Cette Étape n’a pas de Retour : elle ne peut pas demander de changements.'`, `'step-run.no-loop-back'` (same message).
  - The StepRun view sets `canAskChanges` from its PhaseRun's Version.
- **Web**:
  - `apps/web/src/api/phase-runs.ts` (`oneMorePass(id, decisionId)`, `stop(id, decisionId)`).
  - `apps/web/src/views/decisions/loop-back-exhausted.ts`, registered for `loop-back.exhausted`: the context `t('decision.loopBack.context', …)` (« {step} a demandé des changements {count} fois, le maximum de son Retour vers « {target} » : {item} s’est arrêté. ») or, without a Retour, `t('decision.loopBack.contextNoLoopBack', …)` (« {step} a demandé des changements et n’a pas de Retour : {item} s’est arrêté. »); the actions « Encore un passage » (primary, only with `canContinue`), « Arrêter », « Voir la Session » (only with a `sessionId`, to the link).
  - `ICONS['loop-back.exhausted'] = 'undo'`; `fr.ts`: `decision.kind.loop-back.exhausted` « Maximum de Retours atteint » and the keys above.
- **Scenario** `apps/server/src/testing/scenarios/a-toi-process.ts` (`a-toi-process`, path `/a-toi`): a Projet « Site mairie », its Version, a PhaseRun of Ticket #57 « Recherche d’actes » waiting on the Décision `loop-back.exhausted` of its Review (`taken: 3`, `max: 3`); PROCESS-12 adds its « Lancement échoué » to the same scenario. E2E `apps/web/e2e/a-toi-process.spec.ts` at 390 and 1280 px, axe; « Encore un passage » removes the row and the PhaseRun is `running`.
- **Tests**: `apps/server/src/process/engine/loop-backs.spec.ts` (the counting); `apps/server/test/integration/process-loop-backs.spec.ts`: « Process Crewdeck »'s Review asking changes three times takes `st-review → st-code` three times (iterations 2, 3, 4 of `st-code`, `st-checks`, `st-review`, `st-rv` superseded each time), the fourth raises the Décision; « Encore un passage » takes it once more, the next « changements » raises it again; « Arrêter » stops the PhaseRun and calls the item's `onStopped`; a Review with no Retour raises it with `canContinue: false` and `one-more-pass` is 422; a gate without Retour signalling `changes` is 422; the routes' 404, 409 `decision.already-answered`, 401; each change and its events in one transaction. `apps/web/src/views/decisions/loop-back-exhausted.spec.ts`: the buttons by `canContinue` and `sessionId`.
- `docs/pilotage/risques.json`, AGT-9: tick « Chaque Retour a son maximum ; la Review, les Checks et le Merge ne se retirent pas », `statutDepuis` dated.

## Decisions already made

- Mockup: `a-toi-process` (page `design/screens/crewdeck/a-toi-process.html`; captures `design/screens/crewdeck/a-toi-process-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. This ticket builds the row « Maximum de Retours atteint »; « Lancement échoué » is PROCESS-12's.
- `max` counts the Retours taken (ADR 0011: « When the PhaseRun has taken it `max` times, the item stops »): with `max: 3`, the fourth « changements » raises the Décision; its context says how many times changes were asked (`taken + 1`).
- The Décision's buttons are ADR 0011's (« Encore un passage », « Arrêter ») and « Voir la Session », in place of the mockup's single « Ouvrir le Ticket »: the row opens its link as every row does.
- « Encore un passage » takes the waiting Retour at once (the Verdict that raised the Décision is the one it answers) and allows exactly one more.
- Stopping the item is the item's module's (`PHASE_ITEMS`): this ticket stops the PhaseRun; closing the Ticket at its Source and abandoning the Conception are BOUCLE-2's and CONCEPTION-1's handlers.
- « Demander des changements » is hidden from `canAskChanges` by each gate's own page; the server refuses it anyway (422), so that a Skin cannot bypass it.
- Neither answer is an Action sensible: the Pilote stops one item or allows one pass, nothing merges.
- The Décision's label is the item's, readable by the server (a GitHub Ticket's title, ADR 0003); a Local item's handler gives its number only.

## Acceptance criteria

- [ ] With `max: 3`, a Review asking changes 3 times sends the work back to `st-code` 3 times (iterations up to 4), the downstream StepRuns `superseded` each time; the 4th raises « Maximum de Retours atteint » and the PhaseRun waits.
- [ ] « Encore un passage » sends it back once more and resolves the Décision; the next « changements » raises it again.
- [ ] « Arrêter » stops the PhaseRun, its running StepRuns through their handlers, calls the item's `onStopped`, and resolves the Décision.
- [ ] A judging Étape without a Retour that gives « changements » raises the Décision without « Encore un passage »; `one-more-pass` on it is 422 `phase-run.no-loop-back`.
- [ ] A gate without a Retour cannot signal `changes` (422), and its StepRun has `canAskChanges: false`; `st-rv` of « Process Crewdeck » has `canAskChanges: true`.
- [ ] The routes: 404 for another Pilote's PhaseRun, 409 for a Décision already answered, 401 without a session; the event of each change in its transaction.
- [ ] The `a-toi-process` scenario shows the row with its icon, kind, context and buttons at 390 and 1280 px, without axe violations.

## Verification

- `pnpm exec nx test contracts -- src/process/ src/api/`
- `pnpm exec nx test server -- src/process/engine/`
- `pnpm exec nx test-integration server -- process-loop-backs`
- `pnpm exec nx test web -- src/views/decisions/`
- `pnpm exec nx e2e web -- a-toi-process.spec.ts`
- `scripts/captures.sh a-toi-process`
- `pnpm exec nx run contracts:generate` then `git diff --exit-code`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing (the migration runs with the deploy).

## Out of scope

- `rerunFrom` (PROCESS-4), which BOUCLE-4 uses after a merge conflict: a rerun that counts against no Retour and raises no `loop-back.exhausted`.
- Drawing a Retour and its maximum on the canvas: PROCESS-9. The judging Étapes' handlers and their « Demander des changements »: BOUCLE-4, BOUCLE-6, CONCEPTION-4, CONCEPTION-6, CONCEPTION-8, CONCEPTION-10.
- Closing the Ticket and abandoning the Conception on « Arrêter »: BOUCLE-2, CONCEPTION-1. « Lancement échoué »: PROCESS-12.

## Dependencies

- PROCESS-4.
