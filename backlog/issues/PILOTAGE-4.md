---
id: PILOTAGE-4
title: "Spend per Étape of a Projet, with the share due to Retours"
epic: PILOTAGE
type: feature
priority: P1
size: M
milestone: M7 Statistics and switchover
blocked_by: [PILOTAGE-3, RUNNER-23]
adr: [0003, 0008, 0011]
risques: [BIZ-4]
stories: [US-115]
screens: [statistiques-par-etape]
revue_visuelle: true
video: false
---

## Context

US-115: the statistics split the spend of a **Projet** by **Étape** of its **Process**, with the share due to **Retours**, so that the Pilote sees which Étape costs, such as a **Review** that sends the work back three times. The spend of a subscription is a share of its 5-hour window, that of an API key euros (RUNNER-23); each bar is the Étape's share of the total of its **Compte IA**, split between first passes and Retours. A Retour is a StepRun with `iteration > 1` (PROCESS-6: `rerunFrom` gives iteration + 1 with `reason: 'loop-back'`); a `retry` keeps the iteration and is not one. The Process may have changed during the period: the spend is grouped by `StepRun.stepId`, in the order of the active version (ADR 0011). Figures only: no title nor content (ADR 0003).

## Current state of the code

- `apps/server/prisma/schema.prisma`: `StepRun` (~1180: `stepId`, `kind`, `iteration`, `reason`, `phaseRunId`, `projectId`), `PhaseRun` (`phaseId`), `ProcessVersion` (~1045: `definition` Json `ProcessDefinition`, `number`, `activatedAt`), `Spend` (~611, with RUNNER-23's `kind`, `costUsdMicros`, `windowPermille`, `stepRunId`, `projectId`, `day`, `measuredAt`).
- `packages/contracts/src/process/definition.ts`: `zPhase` (`id`, `name`, `forEach`, `col`, `row`), `zStep` (`id`, `phaseId`, `kind`, `name`, `tools` with `{ kind: 'role', roleId }`), `FOR_EACH`; `apps/server/src/process/process.view.ts`, `process.service.ts`: the active version of a Projet. `apps/server/src/process/engine/engine.ts` `rerunFrom`, `retry`.
- `apps/server/src/usage/fx.ts`: `toEurCents`; ECB conversion already stored in `Spend.costEurCents`.
- Rôles are strings (`AGENT_ROLES` in `packages/contracts/src/values.ts`, `r-xxxxxxxx` custom ones); a Rôle's Moteur and model are `SettingsService.effective`.
- Design: `design/screens/crewdeck/statistiques-par-etape.html`; components `ui-spend-row`, `ui-stat`, `ui-card` in `design/components.js`.
- Created by PILOTAGE-3: `apps/server/src/statistics/` (`statistics.controller.ts`, period rules `[from, to)` of `zDay`s, at most 366 days, 400 with `fields`, 404 for another Pilote's Projet), `packages/contracts/src/api/statistics.ts`, `/statistiques` (`apps/web/src/views/statistiques.ts`, `apps/web/src/api/statistics.ts`, `PageStatistiques`, its filter and periods, the four `Stat`). Created by RUNNER-23: the `Spend` columns above and `sumSpend` (`apps/server/src/usage/spend-sum.ts`). Created by PROCESS-6: the Retours (`iteration`, `reason: 'loop-back'`).

## To do

- Contract `packages/contracts/src/api/statistics.ts` (extend): `zStepSpend` `{ stepId, name, role?, engine?, kind?: 'api-key' | 'subscription', model?, firstPass, retours, share }` where `firstPass` and `retours` are `{ eurCents?, windowPermille? }` (one of the two, by the Compte IA's kind; zero when the Étape has no spend), `share` an integer 0..100; `zStepSpendReport` `{ totals: [{ engine, kind, eurCents?, windowPermille? }], phases: [{ phaseId, name, forEach: boolean, steps: zStepSpend[] }], retired: zStepSpend[] }`.
- `apps/server/src/statistics/step-spend.ts`, pure `stepSpend({ definition, versionsInPeriod, stepRuns, spends }): StepSpendReport`:
  - join each `Spend` of the Projet with `measuredAt` in `[from, to)` to its StepRun by `stepRunId` (a row without one counts in `totals` only); group by `StepRun.stepId`; `retours` = rows whose StepRun has `iteration > 1`, `firstPass` the others; sums with `sumSpend` (per Compte IA kind, never mixing euros and windows);
  - `share` = the Étape's spend (first passes + Retours) over the total of its Compte IA (Moteur and kind) over the period, rounded to the integer, in the active version; the bar of the Retours is `retours / (firstPass + retours)` of the Étape;
  - order: the phases of the active version (by `col`, `row`), each Étape by `col`, `row`; a stepId absent from the active version goes to `retired`, in the order of the version it was last in, and the page marks it « hors du Process actif »; approvals, Checks, Merge and Commandes are listed too, with no spend shown (« — »: no Compte IA); `name`, `role`, `forEach` read from the active version, or from the latest version in the period holding the stepId (for `retired`).
- `statistics.service.ts` + controller: `GET /api/statistics/steps?projectId=&from=&to=` (same period rules as `GET /api/statistics`: `zDay`s, at most 366 days, `to > from`; `projectId` required): 400 with `fields`, 404 `project.not-found` for another Pilote's Projet, 401. Reads `Spend`, `StepRun`, `ProcessVersion`; no event, no title. The Rôle's Moteur and model of an Étape are those of its Rôle's effective settings now, except `engine` and `kind` that come from the rows themselves when there are some.
- Web: `apps/web/src/api/statistics.ts` `steps(projectId, from, to)` (a query); `apps/web/src/views/statistiques.ts` adds the card when a Projet is chosen (`?projet=`), none for « Tous les Projets »; Composant `cd-spend-row` (`packages/contracts/src/composants/spend-row.ts`, `packages/skin-passerelle/src/spend-row.ts`, in `COMPOSANTS`, an example of the mockup) data `{ step, role, value, share, retours? }` with `role="img"` bar and its label « 98 % du total du Compte IA, dont 52 % en Retours » / « …, sans Retour »; the card « Dépense par Étape » as a `Card` of `PageStatistiques` (a new `steps` Emplacement filled by the view, so the other statistics work without it), t() keys `statistiques.etape.*`.
  - the card: a total line (« 36,04 € sur la clé API de Codex · 2,8 fenêtres de 5 h de Claude », one part per Compte IA) with the legend « premiers passages » / « Retours »; one group per Phase (« Idée », « Conception », « Développement · pour chaque Ticket »), each row `Étape`, `Rôle · Moteur · model` (« Review · Codex · clé API »), the value (« 0,84 € », « 1,1 fenêtre »), the bar and « 98 % · dont Retours 52 % » or « · sans Retour »; the Étapes of `retired` under a group « hors du Process actif »; the definitions line of the mockup under the card. « estimé » beside euros as in the other statistics.
  - Window units: `windowPermille / 1000` in windows, one decimal (« 1,1 fenêtre »), totals as the sum of the Étapes' shares.
- Test scenario `apps/server/src/testing/scenarios/statistiques.ts` (extend PILOTAGE-3's: a Projet with the Process of the mockup, Code and Review with Retours, one Codex API-key and one Claude subscription), Playwright `apps/web/e2e/statistiques-par-etape.spec.ts`.

## Decisions already made

- Mockup: `statistiques-par-etape` (page `design/screens/crewdeck/statistiques-par-etape.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The four `Stat` and the table of PILOTAGE-3 are its.
- The card shows when a Projet is chosen: a Process is a Projet's.
- Each bar is the Étape's share of the total of its Compte IA over the period (so the Étapes of one Compte compare), not of the sum of euros and windows, which cannot be added.
- A Retour is a StepRun with `iteration > 1`; a `retry` is not one. A conflict rerun (`fix-conflict`, not counted against a Retour's maximum) has `iteration + 1` too and counts as a Retour here: it is spend after a return of the work.
- A Process version changed during the period: grouped by `stepId`, in the order of the active version; an Étape absent from it comes last, « hors du Process actif ».
- Totals per Étape in windows (the sum of the shares), as drawn; the cost per Ticket of PILOTAGE-3 stays in % of the 5-hour window (permille / 10).
- Euros for an API key at the ECB rate of the spend's day (ADR 0008); always an estimate.
- A spend with no StepRun (a Commande's, an older row) counts in the totals, in no Étape.

## Acceptance criteria

- [ ] `stepSpend` on rows of Code (`iteration` 1 and 2) and Review (1, 2, 3): `firstPass` and `retours` by `iteration > 1`; a `retry` with the same iteration counts as a first pass (unit tests).
- [ ] A Review at 35,20 € out of a Codex total of 36,04 € has `share: 98`; Étapes of a Claude subscription never mix with euros in a share.
- [ ] A Process version changed in the period: the old stepId absent from the active version is in `retired`, after the groups, with its name from the latest version that held it; its spend still counts in `totals`.
- [ ] Approvals, Checks, Merge and Commandes are listed with « — » and no bar.
- [ ] `GET /api/statistics/steps`: output schema, 400 with `fields` (period over 366 days, `to <= from`, missing `projectId`), 401, 404 for another Pilote's Projet; another Pilote's rows never counted; no title in the response.
- [ ] `/statistiques?projet=<id>` shows the card « Dépense par Étape » with its total line, legend, groups and definitions; « Tous les Projets » shows none; a period without spend shows « — ».
- [ ] The card matches `statistiques-par-etape` at 390 and 1280 px (Playwright against the fake Runner and the fake GitHub, axe without violations; each bar has its text label); the captures come from those tests.

## Verification

- `pnpm exec nx test server -- src/statistics/step-spend.spec.ts`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- statistics`
- `pnpm exec nx test contracts`, `pnpm exec nx test skin-passerelle -- src/spend-row.spec.ts`
- `pnpm exec nx e2e web -- statistiques-par-etape.spec.ts`
- `scripts/captures.sh statistiques-par-etape`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

Nothing.

## Out of scope

- The `Spend` rows, their kinds and the window share: RUNNER-23. The four statistics, the table per Projet and the period: PILOTAGE-3.
- A cap on spending (Bêta), the weekly report and a client's summary (Bêta).
- Showing the spend in « À toi »: ATOI-5.

## Dependencies

- PILOTAGE-3
- RUNNER-23
