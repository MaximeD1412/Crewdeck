---
id: CONCEPTION-1
title: "Conceptions: the Design model, starting one from a retained Idée, the Conceptions list"
epic: CONCEPTION
type: feature
priority: P0
size: M
milestone: M6 Conception
blocked_by: [IDEE-3, RUNNER-12, PARAM-4]
adr: [0001, 0003, 0007, 0008]
risques: []
stories: [US-8]
screens: [conceptions, conceptions-vide]
revue_visuelle: true
video: false
---

## Context

US-8: the Pilote starts the Conception of a retained Idée in one click, so that an agent runs the product design with them. A **Conception** (`Design`) turns a retained Idée into Tickets through its Étapes: PRD, Revue croisée of the PRD, Maquettes, Conception technique, Revue croisée of the technical design, Découpage en Tickets; the Étapes optionnelles (`mockups`, `cross-review`) are skipped when off for the Projet (US-83). This ticket lays the model every CONCEPTION ticket uses, the start, the pure next-Étape function and the `/conceptions` list. The model is the dotfiles `design` tool's record (`MaximeD1412/dotfiles`, `agents/tools/design/README.md` « Conceptions »): facts stored, states computed.

## Current state of the code

- Created by IDEE-3: `retained` Idées, the retained Idée's page (`idee-retenue`) with a slot for « Lancer la Conception ».
- Created by RUNNER-12: `StepRun`, `StepsService.start`, the embedded Skills, `crewdeck-runner etape`.
- Created by PARAM-4: the Étapes optionnelles in `SettingsService.effective(pilotId, projectId).optionalSteps`.
- Created by RUNNER-9: `AgentSession`; by UI-5 / UI-6: `ListRow`, `AgentRow`, `ProcessTrack`, `StatusBadge`, `Tabs`, `Empty`.
- No `designs` module, no `/conceptions` page.

## To do

- **Contracts** `packages/contracts/src/api/designs.ts`:
  - `zDesignStepKind = 'prd' | 'cross-review-prd' | 'mockups' | 'technical-design' | 'cross-review-technical' | 'split'` (the order of the Process).
  - `zDesignStepState = 'todo' | 'running' | 'checking' | 'ready' | 'changes-requested' | 'approved' | 'skipped' | 'incomplete' | 'failed'` (`skipped`: « sans objet » or turned off when reached).
  - `zDesignStep = { kind, state, stepRunId: zId | null, prNumber: number | null, branch: string | null, headSha: string | null, verdictSha: string | null, approvedSha: string | null, approvedAt: zInstant | null, startedAt: zInstant | null, figures: { storyCount?, openQuestions?, screenCount?, ticketCount?, remarks?, nonRetenues? } }`.
  - `zDesign = { id, projectId, ideaId, title: string | null, slug: string | null, prdPath: string | null, state: 'in-progress' | 'done', steps: zDesignStep[] (all six, in order), startedAt, doneAt: zInstant | null }`.
  - `zStartDesignInput = { seq }`; event `design.upserted`.
- **Prisma** `Design` (`designs`: `pilotId`, `projectId`, `ideaId` unique, `title?`, `slug?`, `prdPath?`, `state`, `startedAt`, `doneAt?`) and `DesignStep` (`design_steps`: `pilotId`, `designId`, `kind`, unique `(designId, kind)`, the fields above, `figures Json`).
- **Server** `apps/server/src/designs/`:
  - `next-step.ts`: pure `nextStep(design, { optionalSteps, prdHasScreens }) → zDesignStepKind | 'done'` (after `prd`: `cross-review-prd` if `cross-review` is on and it is not done, else `mockups` if `mockups` is on and the PRD has screens, else `technical-design`; after `mockups`: `technical-design` (then `cross-review-technical` if on); then `split`; then `done`) and `stepStates(design, optionalSteps)` for the page (a `todo` step whose Étape optionnelle is off is shown `off`, « désactivée pour ce Projet »). Unit-tested on every combination.
  - `POST /api/ideas/:id/design { seq }` (« Lancer la Conception »): the Idée is `retained` (422 `designs.idea-not-retained`), without a Conception (422 `designs.already-started`), its Projet visé an existing Projet of the Pilote (422 `designs.no-project`: a new Projet needs its repository first, out of the MVP). Creates the `Design` and its six `DesignStep`s `todo`, then starts the `prd` Étape: `StepsService.start` with step `prd`, Rôle `design`, `subjectType: 'design'`, the Idée's id as the Skill's argument; `prd` becomes `running`. One transaction, `design.upserted` written.
  - `designs.state.ts`: `StateContributor` key `designs`: the Conceptions `in-progress`, and the `done` ones of the last 90 days; `GET /api/designs?state=done&cursor=` for older ones (50 per page).
  - A `StepRun` of a Conception changing state (`step-run.upserted` from RUNNER-12) updates its `DesignStep` (`running`, `incomplete`, `failed`) through `designs/step-runs.listener.ts`; `passed` is handled by each Étape's ticket (CONCEPTION-3 onwards).
- **Web**:
  - « Lancer la Conception » (primary) in the retained Idée's page slot; on success, navigate to `/conceptions/:id`.
  - `/conceptions`: `apps/web/src/views/conceptions.ts` and Composant `PageConceptions` (`packages/contracts/src/composants/page-conceptions.ts`, `packages/skin-passerelle/src/page-conceptions.ts`): header « Conceptions », « N en cours »; Projet chips with counts; tabs « En cours » · « Terminées » with counts; one `ListRow` per Conception (title: `Design.title`, else the Idée's decrypted title from the plaintext cache; meta « <Projet> · retenue le <date> »; a `StatusBadge` of the current Étape: « PRD en cours », « PRD à relire », « Maquettes en cours », « Contrat incomplet »…; « Étape k sur n » where n counts PRD, Maquettes when on, Conception technique, Tickets; « revue croisée désactivée pour ce Projet » when off; a compact `ProcessTrack`); opening a row goes to `/conceptions/:id`.
  - The card « Sessions en cours »: one `AgentRow` per running Étape of a Conception (Projet, « <title> · <Étape> », Moteur, « depuis 12 min ») with « Ouvrir » (`?session=<id>`).
  - Empty state (`conceptions-vide`): « Aucune Conception en cours », its text, « Voir les Idées » → `/idees`.
  - Copy under `t('conceptions.*')`; the Étapes' labels in `t('design.steps.*')` shared with CONCEPTION-2.
- **Tests and scenarios**: `apps/server/src/testing/scenarios/conceptions.ts` (`conceptions` with the mockup's three Conceptions, `conceptions-vide`), `apps/web/e2e/conceptions.spec.ts`.

## Decisions already made

- Mockup: `conceptions`, `conceptions-vide` (pages `design/screens/crewdeck/conceptions.html`, `…/conceptions-vide.html`; captures `design/screens/crewdeck/conceptions-390.png`, `…-1280.png` and the same for the state). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- A Conception's title is readable by the server only once its PRD's PR exists (ADR 0003: « Conceptions (their PR) »); before that the page shows the Idée's title, decrypted in the browser.
- One Conception per Idée at the MVP (the dotfiles' several ideas per Conception are not needed: merged Idées point to their target).
- Étapes optionnelles are read when an Étape is reached, not frozen at the start: turning `mockups` off mid-Conception skips it.
- Starting a Conception is not an Action sensible (US-26's list): no confirmation.
- The Conception runs in the target Projet's repository; Conceptions for a new Projet (no repository) wait for US-81 (`later`).

## Acceptance criteria

- [ ] « Lancer la Conception » on a retained Idée creates its Conception with six Étapes, starts the `prd` Étape with the Rôle Conception's Moteur, and opens `/conceptions/:id`.
- [ ] A second start on the same Idée is refused with `designs.already-started`; an Idée `analysed` with `designs.idea-not-retained`; an Idée whose Projet visé is « nouveau » with `designs.no-project`.
- [ ] `nextStep` covers: all on with screens; mockups off; cross review off; a PRD without screens; the end (`done`).
- [ ] `/conceptions` lists the Conceptions in progress with their current Étape, « Étape k sur n » and the turned-off cross review; « Terminées » lists the done ones; the chips filter by Projet.
- [ ] « Sessions en cours » shows the running Étape and « Ouvrir » opens its Session panel.
- [ ] Route baseline (ADR 0008) for `POST /api/ideas/:id/design` and `GET /api/designs`: nominal, 400, 401, 404 for another Pilote's Idée, 409 stale `seq`, 422 for each rule; the Design and its event in one transaction.
- [ ] Playwright at 390 and 1280 px on `conceptions` and `conceptions-vide`, axe without violations.

## Verification

- `pnpm exec nx test server -- src/designs/`
- `pnpm exec nx test-integration server -- designs`
- `pnpm exec nx test skin-passerelle -- src/page-conceptions.spec.ts`
- `pnpm exec nx e2e web -- conceptions.spec.ts`
- `pnpm exec nx run contracts:generate` with no diff; `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`
- `scripts/captures.sh` for `conceptions`, `conceptions-vide`.

## For prod

A Prisma migration (`designs`, `design_steps`). Nothing else.

## Out of scope

- A Conception's own page: CONCEPTION-2.
- The PRD Skill, its Contrat and its PR: CONCEPTION-3 (until then the `prd` Étape starts a Session without its Skill only in tests against the fake Runner).
- The other Étapes: CONCEPTION-5 (Maquettes), CONCEPTION-7 (Conception technique), CONCEPTION-8 (Revue croisée), CONCEPTION-9 (Découpage).

## Dependencies

- IDEE-3.
- RUNNER-12.
- PARAM-4.
