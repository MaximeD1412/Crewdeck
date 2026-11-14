---
id: IDEE-2
title: "Analysis of an Idée: the idea-analysis kind handler, its Skill and its Contrat, the Idée page"
epic: IDEE
type: feature
priority: P0
size: M
milestone: M5 Idées
blocked_by: [IDEE-1, RUNNER-12, ATOI-2, PROCESS-5]
adr: [0003, 0004, 0005, 0008, 0011]
risques: [IA-6, SEC-7]
stories: [US-6, US-48]
screens: [idee, idees-analyse-echouee]
revue_visuelle: true
video: false
reprend: 69
---

## Context

US-6: each Idée is analysed (summary, target Projet the Pilote can correct, impact, effort, possible duplicates) so that the Pilote triages in seconds. US-48: the analysis is an Étape checked against its Contrat; a failed one raises a Décision to run it again and the Idée stays open to triage. ADR 0003: the analysis is end-to-end encrypted (it is text), its figures are readable; it needs the Runner, so an Idée noted while the Runner is offline waits « en attente du Runner ».

The refonte (PRD #169, ADR 0011) makes the analysis an Étape of the Process like any other: the « Idée » Phase is repeated « pour chaque » noted Idée (`forEach: idea.noted`), and its `idea-analysis` Étape is run by a **kind handler** of PROCESS-4's engine. An Idée noted with a Projet runs that Projet's active version; an Idée without a Projet (US-5) runs the « Idée » Phase of the release's « Process Crewdeck » with the account's Rôle Idée (PROCESS-5). The Rôle, the Skill and the Serveurs MCP come from the Étape's Outils, not from a fixed table. The model is the dotfiles `ideas` tool's analysis (`MaximeD1412/dotfiles`, `agents/tools/ideas/prompts/analyze.md`, `agents/tools/ideas/lib/analysis.mjs`). IDEE-3 builds the next Étape (the `idea-triage` gate), IDEE-5 the draft of a Ticket.

## Current state of the code

- No `apps/server/src/ideas/`, no `/idees` page on develop. `DECISION_KINDS` (`packages/contracts/src/api/decisions.ts`) has `contract-incomplete`, `step-failed`, `ideas-to-triage`; `STEP_IDS` (`packages/contracts/src/contrats/define.ts`) has `idea-analysis`; `packages/contracts/src/contrats/` holds only `define.ts` and `index.ts` (no Contrat yet); `apps/runner/internal/contrat/checks/` holds only `registry.go` and an example check.
- Created by IDEE-1: `apps/server/src/ideas/` (`Idea` with nullable `analysis`, `impact`, `effort`, `targetProjectId`, `targetIsNew`, `duplicateIds`, `analysedAt`), `POST /api/ideas` creating `to-triage`, the `/idees` page, the plaintext cache `apps/web/src/store/idea-plaintext.ts`, `syncIdeasToTriage`.
- Created by PROCESS-1: `packages/contracts/src/process/catalogue.ts` (the `idea-analysis` kind: family `agent`, its ports, its default Rôle `idea`, its default Skill, its Contrat `idea-analysis`), `templates/process-crewdeck.ts` (the « Idée » Phase, `forEach: idea.noted`: « Analyse de l'Idée » then « Tri de l'Idée »).
- Created by PROCESS-4: `apps/server/src/process/engine/` (`phase_runs`, `step_runs` with `phaseRunId`, `stepId`, `kind`, `iteration`, `state`, `outputs`, `verdict`, `sessionId`), the registry `engine/kinds/` (`StepKindHandler { kind, start, onSignal }`), `Engine.admit(tx, { projectId, phaseId, item })`, events `phase-run`, `step-run`.
- Created by PROCESS-5: an Idée without a Projet admitted on the release's « Process Crewdeck » (the account's Rôle Idée), lineage (`parentPhaseRunId`).
- Created by RUNNER-12: the embedded Skills `apps/runner/skills/`, `crewdeck-runner etape start|report|ask`, `step.report { stepRunId, figures, sealed? }` and `step.verdict`, the agent Session started for a StepRun with its Rôle, Skill and Contrat.
- Created by RUNNER-11 (merged): the Contrat rule kinds and their Go interpreter `apps/runner/internal/contrat/`.
- Created by ATOI-2: the `step-failed` and `contract-incomplete` Décisions raised from a StepRun, `POST /api/step-runs/:id/rerun`. By ATOI-3: the `RunnerWaitingWork` registry (`apps/server/src/runners/waiting-work.ts`).
- Created by MIROIR-6: the Miroir's reads for every Source (`apps/runner/internal/mirror/`, Local through `internal/source/local/`).

## To do

- **Admission** (`apps/server/src/ideas/ideas.service.ts`): `POST /api/ideas` calls, in its transaction, `Engine.admit(tx, { projectId: idea.projectId, phaseId, item: { type: 'idea', id } })` for the Phase whose `forEach` is `idea.noted` (the Projet's active version, or the release's « Process Crewdeck » when `projectId` is null, PROCESS-5), and sets the Idée `analysing` when that PhaseRun starts an `idea-analysis` Étape. A Projet whose active version has no `idea.noted` Phase admits nothing: the Idée stays `to-triage`.
- **Kind handler** `apps/server/src/process/engine/kinds/idea-analysis.ts` (`StepKindHandler`, kind `idea-analysis`), its domain part in `apps/server/src/ideas/analysis.ts`:
  - `start(tx, stepRun)`: asks RUNNER-12's agent Session with the Étape's `role` Outil (its Moteur and model through `SettingsService.effective`), its `skill` Outil, its `mcp` Outils and the Contrat `idea-analysis`, in a scratch directory (no worktree); the StepRun stays queued while the Runner is « hors ligne ».
  - `onSignal(tx, stepRun, signal)`: on `passed` with its `step.report`, stores `analysis` (sealed), `impact`, `effort`, `targetProjectId` (or `targetIsNew: true`), `duplicateIds`, `analysedAt`; the Idée `analysed`; the StepRun's output `{ portId: <its idea Sortie>, type: 'idea', id }`; `idea.upserted`; `syncIdeasToTriage`. On `incomplete` or `failed`: the Idée `to-triage` (open to triage, US-48); the Décision is ATOI-2's.
  - A `RunnerWaitingWork` provider `idea-analysis`: the queued analyses, by Projet (an Idée without Projet counts as « Idées »).
- **Contrat** `packages/contracts/src/contrats/idea-analysis.ts` (ADR 0005's first row), version 1, rules (all `bloquant`):
  - `idea-analysis.report.schema` (`json` on `.crewdeck/report.json`): `{ title ≤ 80, summary ≤ 400, projectId: string, projectWhy, impact: 1..5, impactWhy, effort: 1..5, effortWhy, duplicates: [{ id, why }] ≤ 5, questions: string[] ≤ 3 }`, labels « Le rapport a un titre et un résumé d'au plus 400 caractères », « L'impact et l'effort vont de 1 à 5, chacun avec sa raison »;
  - `idea-analysis.report.project` (`check` `idea-project`): `projectId` is one of the Pilote's Projets in `.crewdeck/context.json` or `nouveau`, « Le Projet visé est un de tes Projets ou « nouveau » »;
  - `idea-analysis.report.duplicates` (`check` `idea-duplicates`): every duplicate id is an open Idée of the context, not the Idée itself, « Les doublons sont des Idées ouvertes ».
  - `apps/runner/internal/contrat/checks/idea_project.go` and `idea_duplicates.go`, registered in `registry.go`, each with a passing and a failing fixture.
- **Skill** `apps/runner/skills/<the catalogue's default Skill of idea-analysis>/SKILL.md` (`analyse-idee` in the mockup `process`), ported from the `ideas` tool's `analyze.md`: read `.crewdeck/context.json`, write `.crewdeck/report.json` in French (the anchors of impact and effort 1–5 kept word for word), then `crewdeck-runner etape report --file .crewdeck/report.json`. No tool other than reading and writing those two files.
- **Runner** `apps/runner/internal/steps/ideaanalysis/` (the preparation of the kind `idea-analysis`, beside RUNNER-12's Session start): before the Session, writes `.crewdeck/context.json` in `~/.crewdeck/scratch/<sessionId>/`: the Idée's text decrypted with the vault key, the Pilote's Projets (id, name — a Local Projet's sealed name decrypted), the open Idées decrypted (id, number, title, summary), and each Projet's open Tickets (number, title) read from the Miroir's store (`internal/mirror`), whatever their Source. On `etape report`, the Runner checks the Contrat, then sends `step.report { figures: { impact, effort, projectId | 'nouveau', duplicateIds }, sealed }`, `sealed` holding title, summary, the reasons, the duplicates' why and the questions: the text is sealed **before** it leaves the Runner.
- **Routes** (`apps/server/src/ideas/ideas.controller.ts`, contracts in `packages/contracts/src/api/ideas.ts`):
  - `POST /api/ideas/:id/target { projectId: zId | null, seq }` (« Changer » the Projet visé; `null` = « nouveau »): 404 for another Pilote's Projet, 422 `ideas.not-triageable` when the Idée is merged or rejected. The running PhaseRun keeps its version (ADR 0011: the Idée's next Phases follow the new Projet's Process).
  - `POST /api/ideas/:id/reanalyse { seq }` (« Relancer l'analyse »): ATOI-2's rerun of the Idée's latest `idea-analysis` StepRun, for an Idée `to-triage` or `analysed`; 422 `ideas.analysis-running` when one runs, 422 `ideas.not-triageable` when closed, 422 `ideas.no-analysis-step` when its PhaseRun has no `idea-analysis` Étape. The previous analysis is kept until the new one passes.
  - Messages in `apps/server/src/errors/messages.ts`: `ideas.not-triageable` « Cette Idée n'est plus à trier. », `ideas.analysis-running` « L'analyse de cette Idée est déjà en cours. », `ideas.no-analysis-step` « Le Process de cette Idée n'a pas d'analyse. ».
- **Web**:
  - The Idée page `/idees/:id`: `apps/web/src/views/idee.ts`, Composant `PageIdee` (`packages/contracts/src/composants/page-idee.ts`, `packages/skin-passerelle/src/page-idee.ts`, registered in `COMPOSANTS`) with the cards « Notée » (the quoted text, « par toi · au téléphone | au PC[, dictée] · <time> »), « Analyse » (summary, Projet visé with « Changer », impact and effort with their reasons, « Rôle Idée · <Moteur> · <time> »), « Doublons possibles » (`ListRow` per duplicate, opening it); the status badge of the state. Slot `actions` for IDEE-3's and IDEE-5's buttons.
  - The `/idees` list shows on each `IdeaRow` impact, effort and « doublon possible : #n », the summary as context, and the « Analyse · #n » aside of the selected Idée (same cards, compact); « L'analyse est en cours. » while `analysing`, « En attente du Runner » when its StepRun is queued and the Runner is « hors ligne ».
  - A failed analysis (`idees-analyse-echouee`): the row's « Analyse échouée » badge and « Relancer l'analyse »; the aside's `halt` banner « Analyse échouée » listing the failed rules' labels (from the Contrat declarations, by rule id), « Une Décision « Contrat incomplet » t'attend aussi dans « À toi ». », the Rôle line, and « Tu peux aussi la trier sans analyse : » above the slot for IDEE-3's actions.
  - Impact and effort shown as words: 1–2 « faible », 3 « moyen », 4–5 « fort » (`apps/web/src/views/rating.ts`).
  - Copy under `t('idee.*')` and `t('idees.analyse.*')` in `packages/sdk/src/i18n/fr.ts`.
- **Tests and scenarios**: `apps/server/src/testing/scenarios/idee.ts` (`idee`, `idees-analyse-echouee`), the fake Runner answering an analysis with a recorded report; `apps/web/e2e/idee.spec.ts`.

## Decisions already made

- Mockup: `idee`, `idees-analyse-echouee` (pages `design/screens/crewdeck/idee.html`, `…/idees-analyse-echouee.html`; captures `design/screens/crewdeck/idee-390.png`, `…-1280.png` and the same for the state). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The triage buttons (« Retenir », « Fusionner… », « Rejeter ») are IDEE-3's, « En faire un Ticket » IDEE-5's.
- The analysis runs because the Process has the Étape, never because of a setting: a Projet whose « Idée » Phase has no `idea-analysis` gets Idées to triage without analysis, and the page shows no « Analyse » card for them.
- The Session runs in a scratch directory, not a worktree: an Idée may have no Projet and the analysis reads no code. It reads the Tickets through the Miroir's store, whatever their Source, never through the server.
- Figures are readable (ADR 0003's table): impact, effort, the target Projet's id, duplicate ids. Every sentence (summary, reasons, questions) is sealed by the Runner.
- The words for impact and effort are a display mapping; the stored figure stays 1–5 (ADR 0005).
- « Relancer l'analyse » and the Décision's rerun end in the same state: `reanalyse` calls ATOI-2's rerun.
- « planned » tickets of the `ideas` tool are not shown at the MVP (no mockup); the Skill does not produce them.

## Acceptance criteria

- [ ] Noting an Idée of a Projet whose « Idée » Phase has an `idea-analysis` Étape admits a PhaseRun and starts its StepRun; the fake Runner's report makes the Idée `analysed` with impact, effort, Projet visé and duplicates, on screen within 2 s.
- [ ] Noting an Idée without a Projet runs the same analysis on the release's « Process Crewdeck » (its PhaseRun pinned to it), with the account's Rôle Idée.
- [ ] A Projet whose active version has no `idea.noted` Phase: the Idée is `to-triage`, no PhaseRun, no Session.
- [ ] The stored `analysis` is ciphertext only; the `step.report` payload logged by the server (ids only) contains no sentence of it.
- [ ] Noted with the Runner « hors ligne », the Idée shows « En attente du Runner » and is listed by the `idea-analysis` waiting-work provider; its analysis starts when the Runner sends `hello`.
- [ ] A report whose summary is 401 characters gives `incomplete` with `idea-analysis.report.schema`; the Idée is `to-triage`, the row shows « Analyse échouée », the aside lists the failed label, and « Relancer l'analyse » starts a new StepRun.
- [ ] A duplicate id that is not an open Idée fails `idea-analysis.report.duplicates`; a `projectId` outside the context fails `idea-analysis.report.project` (Go tests with fixtures).
- [ ] The context lists the open Tickets of a Local Projet as of a GitHub one (Go test on a temporary Local folder and a recorded GitHub copy).
- [ ] « Changer » sets another Projet visé or « nouveau »; the analysis is not rerun and the running PhaseRun keeps its version.
- [ ] Route baseline for `target` and `reanalyse`: nominal, 400, 401, 404 for another Pilote's Idée, 409 stale `seq`, 422 for each rule above.
- [ ] Playwright at 390 and 1280 px on `idee` and `idees-analyse-echouee`, axe without violations.

## Verification

- `cd apps/runner && go test ./internal/contrat/... ./internal/steps/ideaanalysis/`
- `pnpm exec nx test server -- src/ideas/analysis.spec.ts src/process/engine/kinds/idea-analysis.spec.ts`
- `pnpm exec nx test-integration server -- ideas`
- `pnpm exec nx test contracts -- src/contrats/idea-analysis.spec.ts`
- `pnpm exec nx e2e web -- idee.spec.ts`
- `pnpm exec nx run contracts:generate` with no diff; `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`
- `scripts/captures.sh idee idees-analyse-echouee`.

## For prod

Nothing (the Skill ships inside the Runner's release).

## Out of scope

- Retain, merge, reject, back to triage (the `idea-triage` gate): IDEE-3. « En faire un Ticket »: IDEE-5.
- The PhaseRun of an Idée without a Projet and the lineage: PROCESS-5. The engine itself: PROCESS-4.
- Answering the analysis' questions: not at the MVP (no story).
- The `contract-incomplete` / `step-failed` Décisions themselves: ATOI-2.

## Dependencies

- IDEE-1.
- RUNNER-12.
- ATOI-2.
- PROCESS-5.
