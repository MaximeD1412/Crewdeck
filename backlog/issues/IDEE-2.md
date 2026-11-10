---
id: IDEE-2
title: "Analysis of an Idée: the Rôle Idée Session, its Skill and its Contrat, the Idée page"
epic: IDEE
type: feature
priority: P0
size: M
milestone: M5 Idées
blocked_by: [IDEE-1, RUNNER-12, ATOI-2]
adr: [0003, 0004, 0005, 0008]
risques: [IA-6, SEC-7]
stories: [US-6, US-48]
screens: [idee, idees-analyse-echouee]
revue_visuelle: true
video: false
---

## Context

US-6: each Idée is analysed (summary, target Projet the Pilote can correct, impact, effort, possible duplicates) so that the Pilote triages in seconds. US-48: the analysis is an Étape checked against its Contrat; a failed one raises a Décision to run it again and the Idée stays open to triage. ADR 0003: the analysis is end-to-end encrypted (it is text), its figures are readable; it needs the Runner, so an Idée noted while the Runner is offline waits « en attente du Runner ». The model is the dotfiles `ideas` tool's analysis (repository `MaximeD1412/dotfiles`, `agents/tools/ideas/prompts/analyze.md` and `agents/tools/ideas/lib/analysis.mjs`).

## Current state of the code

- Created by IDEE-1: `apps/server/src/ideas/` (`Idea` with nullable `analysis`, `impact`, `effort`, `targetProjectId`, `targetIsNew`, `duplicateIds`, `analysedAt`), `POST /api/ideas` creating `to-triage`, the `/idees` page, the plaintext cache `apps/web/src/store/idea-plaintext.ts`, `syncIdeasToTriage`.
- Created by RUNNER-9 / RUNNER-12: `AgentSession`, `StepRun` (`apps/server/src/steps/`, `StepsService.start`), the embedded Skills folder `apps/runner/skills/`, `crewdeck-runner etape start|report|ask`.
- Created by RUNNER-11: the Contrat declarations (`packages/contracts/src/contrats/`, `defineContrat`), their Go interpreter `apps/runner/internal/contrat/` and `checks/`, the `step.verdict` message.
- Created by ATOI-2: the `step-failed` and `contract-incomplete` Décisions raised from a `StepRun`, `POST /api/step-runs/:id/rerun`.
- Created by ATOI-3: the `RunnerWaitingWork` registry.
- No analysis Skill, no `idea-analysis` Contrat, no Idée page.

## To do

- **Contrat** `packages/contracts/src/contrats/idea-analysis.ts` (ADR 0005's first row), version 1, rules (all `bloquant`):
  - `idea-analysis.report.schema` (`json` on `.crewdeck/report.json`): `{ title ≤ 80, summary ≤ 400, projectId: string, projectWhy, impact: 1..5, impactWhy, effort: 1..5, effortWhy, duplicates: [{ id, why }] ≤ 5, questions: string[] ≤ 3 }`, labels « Le rapport a un titre et un résumé d'au plus 400 caractères », « L'impact et l'effort vont de 1 à 5, chacun avec sa raison »;
  - `idea-analysis.report.project` (`check` `idea-project`): `projectId` is one of the Pilote's Projets in `.crewdeck/context.json` or `nouveau`, label « Le Projet visé est un de tes Projets ou « nouveau » »;
  - `idea-analysis.report.duplicates` (`check` `idea-duplicates`): every duplicate id is an open Idée of the context, not the Idée itself, label « Les doublons sont des Idées ouvertes ».
  - The two functions in `apps/runner/internal/contrat/checks/idea_project.go` and `idea_duplicates.go` with their tests (one passing fixture, one failing with the rule id).
- **Skill** `apps/runner/skills/idea-analysis/SKILL.md`, ported from the `ideas` tool's `analyze.md`: read `.crewdeck/context.json`, write `.crewdeck/report.json` in French (the anchors of impact and effort 1–5 kept word for word), then run `crewdeck-runner etape report --file .crewdeck/report.json`. No tool other than reading and writing those two files.
- **Runner** `apps/runner/internal/steps/ideaanalysis/`: before the Session starts, writes `.crewdeck/context.json` in the Session's scratch directory `~/.crewdeck/scratch/<sessionId>/` (no repository): the Idée's text decrypted with the vault key, the Pilote's Projets (id, name, repository), the open Idées decrypted (id, number, title, summary), the open Tickets' titles (from `GET /api/tickets?state=open` with the Runner's token). On `etape report`, the Runner checks the Contrat, then sends `step.report` with `{ analysis: zSealedItem (title, summary, projectWhy, impactWhy, effortWhy, duplicates' why, questions), figures: { impact, effort, projectId | 'nouveau', duplicateIds } }`: the text is sealed **before** it leaves the Runner. The Idée routes accept the Runner's token (ADR 0008 scope).
- **Server** (`apps/server/src/ideas/analysis.ts`):
  - `POST /api/ideas` now creates the Idée `analysing` and starts a `StepRun` (step `idea-analysis`, Rôle `idea`, `subjectType: 'idea'`, `projectId` the Idée's or null) in the same transaction. `StepRun.projectId` and `AgentSession.projectId` are nullable for `subjectType: 'idea'` (migration here if RUNNER-9 / RUNNER-12 made them required).
  - A `RunnerWaitingWork` provider `idea-analysis`: the queued analyses, by Projet (an Idée without Projet counts as « Idées »). Queued runs start when the Runner comes back.
  - On a `passed` verdict with its `step.report`: `analysis`, `impact`, `effort`, `targetProjectId` (or `targetIsNew: true`), `duplicateIds`, `analysedAt` stored, state `analysed`, `idea.upserted`, `syncIdeasToTriage`.
  - On `incomplete` or `failed`: state `to-triage` (the Idée stays open to triage, US-48), the Décision is ATOI-2's; nothing else.
  - `POST /api/ideas/:id/target { projectId: zId | null, seq }` (« Changer » the Projet visé; `null` = « nouveau »): 404 for another Pilote's Projet, 422 `ideas.not-triageable` when the Idée is merged or rejected.
  - `POST /api/ideas/:id/reanalyse { seq }`: a new `StepRun` for an Idée `to-triage` or `analysed` (« Relancer l'analyse »), state `analysing`; 422 `ideas.analysis-running` when one runs, 422 `ideas.not-triageable` when closed. A previous analysis is kept until the new one passes.
- **Web**:
  - The Idée page `/idees/:id`: `apps/web/src/views/idee.ts`, Composant `PageIdee` (`packages/contracts/src/composants/page-idee.ts`, `packages/skin-passerelle/src/page-idee.ts`) with the cards « Notée » (the quoted text, « par toi · au téléphone | au PC[, dictée] · <time> »), « Analyse » (summary, Projet visé with « Changer », impact and effort with their reasons, « Rôle Idée · <Moteur> · <time> »), « Doublons possibles » (`ListRow` per duplicate, opening it); the status badge of the state. Slot `actions` for IDEE-3's and IDEE-5's buttons.
  - The `/idees` list now shows on each `IdeaRow` impact, effort and « doublon possible : #n », the summary as context, and the « Analyse · #n » aside of the selected Idée (same cards, compact); « L'analyse est en cours. » while `analysing`, « En attente du Runner » when its `StepRun` is queued and the Runner is « hors ligne ».
  - A failed analysis (`idees-analyse-echouee`): the row's « Analyse échouée » badge and « Relancer l'analyse »; the aside's `halt` banner « Analyse échouée » listing the failed rules' labels (from the Contrat declarations, by rule id), « Une Décision « Contrat incomplet » t'attend aussi dans « À toi ». », the Rôle line, and « Tu peux aussi la trier sans analyse : » above the slot for IDEE-3's actions.
  - Impact and effort shown as words: 1–2 « faible », 3 « moyen », 4–5 « fort » (`apps/web/src/views/rating.ts`).
  - Copy under `t('idee.*')` and `t('idees.analyse.*')`.
- **Tests and scenarios**: `apps/server/src/testing/scenarios/idee.ts` (`idee`, `idees-analyse-echouee`), the fake Runner (RUNNER-2) answering an analysis with a recorded report; `apps/web/e2e/idee.spec.ts`.

## Decisions already made

- Mockup: `idee`, `idees-analyse-echouee` (pages `design/screens/crewdeck/idee.html`, `…/idees-analyse-echouee.html`; captures `design/screens/crewdeck/idee-390.png`, `…-1280.png` and the same for the state). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The triage buttons (« Retenir », « Fusionner… », « Rejeter ») are IDEE-3's, « En faire un Ticket » IDEE-5's.
- The analysis Session runs in a scratch directory, not a worktree: an Idée may have no Projet and the analysis reads no code.
- Figures are readable (ADR 0003's table): impact, effort, the target Projet's id, duplicate ids. Every sentence (summary, reasons, questions) is sealed by the Runner.
- The words for impact and effort are a display mapping; the stored figure stays 1–5 (ADR 0005).
- A rerun from the Décision (ATOI-2's `POST /api/step-runs/:id/rerun`) and « Relancer l'analyse » end in the same state; the button calls `reanalyse`.
- « planned » tickets of the `ideas` tool are not shown at the MVP (no mockup); the Skill does not produce them.

## Acceptance criteria

- [ ] Noting an Idée with the Runner online starts a `StepRun` `idea-analysis`; the fake Runner's report makes it `analysed` with impact, effort, Projet visé and duplicates, on screen within 2 s.
- [ ] The stored `analysis` is ciphertext only; the `step.report` payload logged by the server (ids only) contains no sentence of it.
- [ ] Noted with the Runner « hors ligne », the Idée shows « En attente du Runner » and is listed by the `idea-analysis` waiting-work provider; its analysis starts when the Runner sends `hello`.
- [ ] A report whose summary is 401 characters gives `incomplete` with `idea-analysis.report.schema`; the Idée is `to-triage`, the row shows « Analyse échouée », the aside lists the failed label, and « Relancer l'analyse » starts a new run.
- [ ] A duplicate id that is not an open Idée fails `idea-analysis.report.duplicates`; a `projectId` outside the context fails `idea-analysis.report.project` (Go tests with fixtures).
- [ ] « Changer » sets another Projet visé or « nouveau »; the analysis is not rerun.
- [ ] Route baseline for `target` and `reanalyse`: nominal, 400, 401, 404 for another Pilote's Idée, 409 stale `seq`, 422 for each rule above.
- [ ] Playwright at 390 and 1280 px on `idee` and `idees-analyse-echouee`, axe without violations.

## Verification

- `cd apps/runner && go test ./internal/contrat/... ./internal/steps/ideaanalysis/`
- `pnpm exec nx test server -- src/ideas/analysis.spec.ts`
- `pnpm exec nx test-integration server -- ideas`
- `pnpm exec nx test contracts -- src/contrats/idea-analysis.spec.ts`
- `pnpm exec nx e2e web -- idee.spec.ts`
- `pnpm exec nx run contracts:generate` with no diff; `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`
- `scripts/captures.sh` for `idee`, `idees-analyse-echouee`.

## For prod

Nothing (the Skill ships inside the Runner's release; a migration only if `StepRun.projectId` had to become nullable).

## Out of scope

- Retain, merge, reject, back to triage: IDEE-3. « En faire un Ticket »: IDEE-5.
- Answering the analysis' questions: not at the MVP (no story).
- The `contract-incomplete` / `step-failed` Décisions themselves: ATOI-2.

## Dependencies

- IDEE-1.
- RUNNER-12.
- ATOI-2.
