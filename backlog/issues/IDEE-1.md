---
id: IDEE-1
title: "Noting an Idée, encrypted in the browser, and the Idées list"
epic: IDEE
type: feature
priority: P0
size: M
milestone: M5 Idées
blocked_by: [E2E-2, ATOI-1, PROJET-2]
adr: [0003, 0006, 0007, 0008]
risques: [SEC-7]
stories: [US-5]
screens: [idees, idees-nouvelle, idees-vide]
revue_visuelle: true
video: false
---

## Context

US-5: the Pilote notes an Idée in one sentence from the PC or the phone, choosing its Projet if they want to, so that nothing is lost. ADR 0003 makes the text of an Idée end-to-end encrypted: the server stores its ciphertext and only readable facts (state, Projet, dates, figures); its « À toi » line and its notifications are generic (« 3 Idées à trier »). This ticket is the intake: the `Idea` model, noting, and the `/idees` list with its tabs. The analysis (IDEE-2), the triage (IDEE-3), dictation (IDEE-4) and « En faire un Ticket » (IDEE-5) build on it.

## Current state of the code

- Only docs exist for this domain: `docs/product/prd.md` (US-5), `CONTEXT.md` (**Idée**), ADR 0003 (what the server reads), `design/screens/crewdeck/idees*.html`.
- Created by E2E-1 / E2E-2: the item encryption (a per-item AES-256-GCM key wrapped by the vault key) in `apps/web/src/keys/` and its envelope schema `zSealedItem` in `packages/contracts/src/crypto/` (use the name E2E-1 gave it), the vault key available on a trusted Appareil.
- Created by ATOI-1: `apps/server/src/decisions/` (`DecisionsService.raise/resolve`, kind `ideas-to-triage` in `zDecisionKind`).
- Created by PROJET-2: `Project` (`apps/server/src/projects/`) and the store's `projects` slice (for the Projet chips and the select).
- Created by CORE-5 / CORE-6: `EventsWriter`, `StateContributor`, the web store and Resynchronisation; by UI-2 to UI-5: `PageHeader`, `ProjectFilter`, `Chip`, `Tabs`, `Card`, `Empty`, `Button`, `Dialog`, `TextField`, `Select`, `IdeaRow`.
- No `ideas` module, no `/idees` page.

## To do

- **Contracts** `packages/contracts/src/api/ideas.ts`:
  - `zIdeaState = 'analysing' | 'to-triage' | 'analysed' | 'retained' | 'merged' | 'rejected'` (UI: « en analyse », « à trier », « analysée », « retenue », « fusionnée », « rejetée »).
  - `zIdea = { id, number, projectId: zId | null, targetProjectId: zId | null, targetIsNew: boolean, state, text: zSealedItem, analysis: zSealedItem | null, impact: 1..5 | null, effort: 1..5 | null, duplicateIds: zId[], notedFrom: 'pc' | 'telephone', dictated: boolean, mergedIntoId: zId | null, reason: zSealedItem | null, ticketNumber: number | null, createdAt, updatedAt, analysedAt: zInstant | null, triagedAt: zInstant | null }`. Fields after `text` are filled by IDEE-2, IDEE-3 and IDEE-5; this ticket creates them all (nullable) so the migration is done once.
  - `zNoteIdeaInput = { text: zSealedItem, projectId: zId | null, notedFrom, dictated: boolean, seq }`; `zListIdeasQuery = { states: zIdeaState[] (non-empty), cursor? }` → `{ items, nextCursor }`.
  - Event schemas `idea.upserted` (payload `zIdea`) in `packages/contracts/src/events/`.
- **Prisma** `Idea` (table `ideas`): the fields above, `pilotId`, `number Int` unique with `pilotId`, `text Json`, `analysis Json?`, `reason Json?`; a counter `ideaSeq Int @default(0)` on `Pilot` gives `number` (incremented in the same transaction). Index `(pilotId, state, updatedAt)`.
- **Server** `apps/server/src/ideas/`: `ideas.controller.ts`, `ideas.service.ts`, `ideas.state.ts` (`StateContributor` key `ideas`: every Idée not merged nor rejected, plus the merged and rejected ones updated in the last 90 days).
  - `POST /api/ideas` → 201 `zIdea` (state `to-triage` until IDEE-2 starts the analysis on creation); `projectId` must be one of the Pilote's Projets (404 `projects.not-found` otherwise).
  - `GET /api/ideas?states=merged&cursor=` → older closed Idées, 50 per page (for « Fusionnées » and « Rejetées » beyond 90 days).
  - Each change writes `idea.upserted` in its transaction.
  - `apps/server/src/ideas/triage-decision.ts`: `syncIdeasToTriage(tx, pilotId)` called by every change of an Idée's state: when the count of Idées in `analysing`, `to-triage` or `analysed` is above 0, the open `ideas-to-triage` Décision (subject the Pilote) exists with label « N Idées à trier » (singular « 1 Idée à trier »), raised or relabelled; at 0 it is resolved. Never any Idée text in it.
  - The logger's redaction list (CORE-1) covers `text`, `analysis`, `reason` of every `ideas` route; a test proves a POST's body is absent from the logs.
- **Web**:
  - `apps/web/src/api/ideas.ts` (`note`, `listClosed`).
  - `apps/web/src/store/` slice `ideas` and a plaintext cache `apps/web/src/store/idea-plaintext.ts`: on each `idea.upserted`, the Idée's `text` (and later `analysis`) is decrypted asynchronously with the vault key (E2E-2) and kept in memory only (never `localStorage`); the view reads it from there. An Idée not decrypted yet shows « Déchiffrement… »; one this Appareil cannot decrypt shows « Illisible sur cet Appareil ».
  - `apps/web/src/views/idees.ts`: pure `ideesView(store, plaintext, { projectFilter, tab })` → the `PageIdees` data: count « N à trier », Projet chips with counts, tabs À trier (analysing + to-triage + analysed) · Retenues · Fusionnées · Rejetées with counts, the rows (`IdeaRow` data: title = the first line of the text, meta `#<number> · <Projet> · <relative time>`, state). Newest first.
  - Composants (ADR 0006): `packages/contracts/src/composants/page-idees.ts` (`PageIdees`, `cd-page-idees`, data above, actions `note`, `open { id }`, `filter { projectId | null }`, `tab { tab }`; slots `list`, `aside`) and `note-idea-dialog.ts` (`NoteIdeaDialog`, data `{ projects, defaultProjectId }`, actions `submit { text, projectId }`, `cancel`); implementations in `packages/skin-passerelle/src/page-idees.ts` and `note-idea-dialog.ts`, with `examples` (nominal, empty, dialog open).
  - The dialog encrypts `text` in the core (never in the Skin: the Skin emits `submit` with the plain text, the core's action handler seals it with `apps/web/src/keys/` before calling `POST /api/ideas`). `notedFrom` is `telephone` below 1280 px of viewport width, else `pc`; `dictated` is false (IDEE-4 sets it).
  - The router maps `/idees` to `PageIdees`; « Noter une Idée » in the « À toi » header (ATOI-1's page) opens the same dialog.
  - Copy under `t('idees.*')` in `packages/sdk/src/i18n/fr.ts`.
- **Test scenarios**: `apps/server/src/testing/scenarios/idees.ts` (`idees` with the mockup's four Idées across three Projets, `idees-vide`), the Playwright spec `apps/web/e2e/idees.spec.ts` (390 and 1280 px, axe).

## Decisions already made

- Mockup: `idees`, `idees-nouvelle`, `idees-vide` (pages `design/screens/crewdeck/idees.html`, `…/idees-nouvelle.html`, `…/idees-vide.html`; captures `design/screens/crewdeck/idees-390.png`, `…-1280.png` and the same for each state). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. Not built here: the « Analyse » aside and its triage buttons (IDEE-2, IDEE-3), the impact, effort and duplicates of a row (IDEE-2), « Dicter » (IDEE-4).
- An Idée has a human number `#<n>` per Pilote, as the mockups show (« #63 »). It is ours, not GitHub's: ADR 0008's « the only human numbers are GitHub's » gets this one exception (noted in the design journal by the backlog's PR).
- The text is encrypted in the core with the per-item key of E2E-1; the server never sees it, the Skin never encrypts. A Pilote whose Appareil is not trusted yet cannot note: the dialog says « Approuve cet Appareil pour noter une Idée » and links to the Paramètres (E2E-3).
- The list's counts and the « À toi » line are generic; the Idée's title is shown only from the browser's plaintext cache.
- Search among Idées runs in the browser on the decrypted cache (used by IDEE-3's merge dialog); there is no server search.

## Acceptance criteria

- [ ] Noting « Pouvoir dupliquer une recette » with the Projet « Personal OS » creates an Idée `#<n+1>`, `to-triage`, shown at the top of « À trier » within 2 s without reload, on this tab and on another open tab.
- [ ] The request body and the stored row contain only ciphertext for the text (an integration test reads the row and checks the plaintext is absent); the server log of the request contains no `text`.
- [ ] Noting without a Projet stores `projectId: null`; a Projet of another Pilote is 404.
- [ ] The `ideas-to-triage` Décision reads « 1 Idée à trier », then « 2 Idées à trier » after a second Idée; it is resolved when none is left to triage (simulated by setting the state in the service test).
- [ ] The tabs count À trier, Retenues, Fusionnées, Rejetées; the Projet chips filter the list and show their counts.
- [ ] With no Idée, the empty state shows « Aucune Idée pour l'instant » and its « Noter une Idée » action opens the dialog.
- [ ] Route baseline (ADR 0008): `POST /api/ideas` 201 matches `zIdea`; 400 with `fields` for an empty `text`; 401 without a session; 404 for another Pilote's Projet; 409 with a stale `seq`; `GET /api/ideas` without `states` is 400.
- [ ] The Composants' `examples` render and their actions emit valid `cd-action` payloads; Playwright at 390 and 1280 px, axe without violations.

## Verification

- `pnpm exec nx test server -- src/ideas/`
- `pnpm exec nx test-integration server -- ideas`
- `pnpm exec nx test skin-passerelle -- src/page-idees.spec.ts`
- `pnpm exec nx test web -- src/views/idees.spec.ts`
- `pnpm exec nx e2e web -- idees.spec.ts`
- `pnpm exec nx run contracts:generate` with no diff; `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`
- `scripts/captures.sh` for `idees`, `idees-nouvelle`, `idees-vide`.

## For prod

A Prisma migration (`ideas` table, `pilots.idea_seq`), applied by the deploy. Nothing else.

## Out of scope

- The analysis, « en attente du Runner », impact, effort, duplicates, the Idée page: IDEE-2.
- Retain, merge, reject, back to triage: IDEE-3. Dictation: IDEE-4. « En faire un Ticket »: IDEE-5.
- Approving a new Appareil: E2E-3.

## Dependencies

- E2E-2.
- ATOI-1.
- PROJET-2.
