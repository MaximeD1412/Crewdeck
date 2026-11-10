---
id: ATOI-1
title: "Décisions and the « À toi » page: one model every module raises and resolves"
epic: ATOI
type: feature
priority: P0
size: M
milestone: M1 Socle
blocked_by: [CORE-6, UI-5]
adr: [0003, 0006, 0007, 0008]
risques: []
stories: [US-17]
screens: [a-toi, a-toi-vide]
revue_visuelle: true
video: false
---

## Context

US-17: every Décision that waits for the Pilote (a blocked Ticket, a Conception to review, a visual review, an interrupted Ticket, an agent's question or permission request, an inventory to approve) is in « À toi », so they never look for them. The glossary: a **Décision** is something that waits for the Pilote, and every Décision is in « À toi ». This ticket gives the model, its service, its events and the page; each kind is raised and resolved by its own module's ticket (SESSION-3, ATOI-2, ATOI-3, PROJET-4, BOUCLE-5 to BOUCLE-7, IDEE-2, IDEE-5, CONCEPTION-4…). ADR 0003: a Décision's kind and short label are readable by the server; its free text is not.

## Current state of the code

- Only documents: the mockups `design/screens/crewdeck/a-toi.html`, `a-toi-vide.html`, `design/DESIGN.md` (« Copy »: a Décision's title is its kind, then its object).
- Created by CORE-1: `apps/server/src/errors/`, the value shapes (`zId`, `zInstant`). CORE-2: `apps/server/src/scope/`. CORE-5: `apps/server/src/realtime/` (`EventsWriter`, `StateContributor`, `GET /api/state`). CORE-6: `apps/web/src/store/`, `apps/web/src/router.ts`, `apps/web/src/views/cadre.ts`, `apps/web/src/api/client.ts`.
- Created by UI-1: `defineComposant`, `t()`, the relative-time formatter of `@crewdeck/sdk`. UI-2: `Card`, `Empty`, `Button`, `PageHeader`, `ProjectFilter`, `Chip`. UI-3: the Cadre (its `decisions` count). UI-5: `DecisionRow`, `AgentRow`.
- No `decisions` table, no page `/a-toi`.

## To do

- **Contract** `packages/contracts/src/api/decisions.ts`:
  - `zDecisionKind`: `ticket-blocked`, `ticket-interrupted`, `permission-requested`, `agent-question`, `limit-reached`, `ai-account-disconnected`, `visual-review`, `document-review`, `inventory-review`, `ticket-draft`, `contract-incomplete`, `step-failed`, `runner-offline`, `ideas-to-triage`.
  - `zDecision`: `{ id, kind, projectId: zId | null, projectName: string | null, subjectType: string, subjectId: string, label: string (≤ 120), metaParts: string[] (≤ 3, each ≤ 40: readable facts such as « Code », « session », « 4 captures »), tone: 'accent' | 'caution' | 'halt', link: string (a page URL), params: Record<string, string | number | boolean | null>, state: 'open' | 'resolved', outcome: string | null, createdAt: zInstant, resolvedAt: zInstant | null }`.
  - Events `decision.upserted` (payload `zDecision`) and `decision.removed` (`{ id }`) in `packages/contracts/src/events/`.
- **Server** `apps/server/src/decisions/`:
  - Prisma model `Decision` (`decisions`, snake_case columns, `pilotId` scoped): the fields above; a partial unique index on `(pilot_id, kind, subject_id) WHERE state = 'open'`; index `(pilot_id, state, created_at)`.
  - `DecisionsService.raise(tx, input)`: creates the open Décision, or updates the open one of the same `(kind, subjectId)` (label, metaParts, tone, link, params); writes `decision.upserted` in the same transaction; returns `{ decision, created: boolean }`.
  - `DecisionsService.resolve(tx, kind, subjectId, outcome)`: sets `resolved`, `outcome`, `resolvedAt`, writes `decision.removed`; no open one → no-op.
  - `DecisionsService.assertOpen(tx, id)`: throws `AppError(409, 'decision.already-answered', 'Cette Décision a déjà été prise.')` when resolved, 404 `decision.not-found` when absent or another Pilote's. Modules call it in the commands that answer a Décision.
  - `GET /api/decisions?state=open|resolved&projectId=&cursor=`: `state` mandatory (400 otherwise); `open` returns every open one; `resolved` is cursor-paginated (50, newest first) → `{ items, nextCursor }`.
  - `StateContributor` key `decisions`: the open ones.
  - Values never contain free text of the Pilote or an agent: a module that has such text leaves it out (the page reads it from GitHub or the Runner); a comment on `raise` says so.
- **Page** `/a-toi` (default route after sign-in):
  - Composant `PageAToi` (`packages/contracts/src/composants/page-a-toi.ts`, `packages/skin-passerelle/src/page-a-toi.ts`): data `{ total, projects: [{ id: zId | null, name, count, selected }], decisions: DecisionRowData[], canNoteIdea: boolean }`; actions `filter { projectId: zId | null }`, `open { id }`, `act { id, action }`, `note-idea`; Emplacements `loops` (the « Boucles en cours » card, filled by BOUCLE-3) and `ai-accounts` (the « Comptes IA » card, filled by RUNNER-13): an empty Emplacement shows nothing.
  - View `apps/web/src/views/a-toi.ts`: open Décisions newest first; the Projet chips: « Tous les Projets » then one per Projet of the store's `projects` slice when it exists (PROJET-2), else one per `projectName` of the open Décisions, each with its count; `canNoteIdea` false until IDEE-1 sets it.
  - Kind views registry `apps/web/src/views/decisions/registry.ts`: `registerDecisionView(kind, { title?, context?, actions })` where an action is `{ id, label (t() key), primary?, needsRunner?, run(decision) }`; the default view for every kind: the kind's label (`decision.kind.<kind>`), the Décision's label as title, `metaParts` and the relative time (« il y a 4 min ») as meta, one action « Ouvrir » that navigates to `link`.
  - The Cadre's `decisions` count = the number of open Décisions.
  - Empty: `Empty` « Rien ne t'attend » with the mockup's sentence.
- t() keys `aToi.*`, `decision.kind.*` (the 14 labels: « Ticket bloqué », « Ticket interrompu », « Permission demandée », « Question de l'agent », « Limite atteinte », « Compte IA déconnecté », « Revue visuelle », « Conception à relire », « Inventaire à approuver », « Ticket à valider », « Contrat incomplet », « Étape échouée », « Runner hors ligne », « Idées à trier »).
- Scenarios `apps/server/src/testing/scenarios/a-toi.ts` (`a-toi`: one open Décision of nine kinds as in the mockup; `a-toi-vide`); Playwright `apps/web/e2e/a-toi.spec.ts`.

## Decisions already made

- Mockup: `a-toi`, `a-toi-vide` (pages `design/screens/crewdeck/a-toi.html`, `…/a-toi-vide.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The « Boucles en cours » and « Comptes IA » cards and each kind's buttons and context lines are their own tickets'.
- Tone per kind is the raising module's choice; the mockup's: halt for blocked and offline, caution for permission, limit, interrupted, incomplete, accent for the rest.
- A resolved Décision leaves the store (`decision.removed`); its row stays for the history (the Journal des Décisions is US-78, Bêta).
- The relative time is computed in the browser from `createdAt`; the server never formats it.
- A Décision is resolved only by its module, never by the page directly: there is no generic « answer » route.

## Acceptance criteria

- [ ] `raise` twice for the same open `(kind, subjectId)` updates the one row and emits two `decision.upserted`; after `resolve`, a new `raise` creates a new row.
- [ ] The change and its event are written in one transaction (a failing event write rolls the Décision back).
- [ ] `GET /api/decisions` follows the route baseline: nominal case against the schema, 400 without `state`, 401 without a session, another Pilote's Décisions never listed; `assertOpen` gives 409 `decision.already-answered` and 404 for another Pilote's.
- [ ] « À toi » lists the open Décisions newest first with kind, title, meta and relative time, updated without reload when one is raised or resolved.
- [ ] The Projet chips filter the list and show their counts; the Cadre shows the open count.
- [ ] No open Décision: the empty state « Rien ne t'attend ».
- [ ] `PageAToi`'s examples render and its actions emit valid `cd-action`s; screens at 390 and 1280 match the mockups, axe without violations.

## Verification

- `pnpm exec nx test server -- src/decisions/decisions.service.spec.ts`
- `pnpm exec nx test-integration server -- decisions`
- `pnpm exec nx test web -- src/views/a-toi.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/page-a-toi.spec.ts`
- `pnpm exec nx e2e web -- a-toi.spec.ts`; `scripts/captures.sh apps/web/e2e/a-toi.spec.ts` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

A migration (table `decisions`), run by the deploy.

## Out of scope

- Raising and resolving each kind, and its buttons: the module tickets (SESSION-3, ATOI-2, ATOI-3, PROJET-4, PROJET-5, BOUCLE-5, BOUCLE-6, BOUCLE-7, IDEE-2, IDEE-5, CONCEPTION-4, CONCEPTION-10).
- The push: ATOI-4. The « Runner hors ligne » banner: ATOI-3. « Noter une Idée »: IDEE-1.

## Dependencies

- CORE-6
- UI-5
