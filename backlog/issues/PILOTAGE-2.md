---
id: PILOTAGE-2
title: "Tree of the open Tickets beside the planning, the critical path in bold"
epic: PILOTAGE
type: feature
priority: P1
size: M
milestone: M4 Boucle
blocked_by: [PILOTAGE-1]
adr: [0006, 0008]
risques: []
stories: [US-63]
screens: [planning]
revue_visuelle: true
video: false
---

## Context

US-63: the tree of the open **Tickets** of a **Projet**, with what blocks what, next to its planning, so that the Pilote sees the critical path at a glance. The data is in the store (BOUCLE-1); the critical path is PILOTAGE-1's `criticalPath`.

## Current state of the code

- No code in the repository: only the docs and `design/`.
- Created by PILOTAGE-1: `/planning`, `PagePlanning` with its `tree` Emplacement, `apps/web/src/views/planning.ts`, `apps/web/src/views/critical-path.ts`, the Tabs « Planning » / « Arbre des Tickets » at 390.
- Created by BOUCLE-1: the `tickets` slice (`blockedBy`, `state`, `loopStep`, `ready`). Created by BOUCLE-3: the display of `loopStep`. Created by ATOI-1: the `decisions` slice.
- Created by UI-6: `TicketTree` and `ui-tree-node` (`number`, `title`, `state`, `depth`, `blocked-by`, `critical`).

## To do

- `apps/web/src/views/ticket-tree.ts`: pure `ticketTree(tickets, decisions)`: a forest of the open Tickets; roots are the Tickets with no open blocker, in `compareForLoop` order; a Ticket appears under its first open blocker (by that order), at `depth + 1`, with `blocked-by` listing its other open blockers (« bloqué par #38 »); every open Ticket appears once; the nodes of `criticalPath` get `critical`.
- Node `state` (TicketRow states of the mockups' library): `pret` ready, `attente` waiting on a blocker, `en-cours` coding or fixing, `en-review`, `checks`, `revue-visuelle`, `bloque`, `interrompu`; the title gets the head reason of an interrupted or blocked Ticket (« Rappels de l'agenda · limite de Claude atteinte »), from its open Décision kind.
- Composant `TicketTreeCard` (`packages/contracts/src/composants/ticket-tree-card.ts`, `packages/skin-passerelle/src/ticket-tree-card.ts`) placed in `PagePlanning`'s `tree` Emplacement: card « Arbre des Tickets ouverts » with the count, the `TicketTree`, the note « En gras : le chemin critique. »; action `openTicket` → `/projets/:id/tickets/:number`.
- The « Arbre des Tickets » tab's count is the open Tickets count; with « Tous les Projets », one tree per Projet under its name.
- At 390 the indentation stops at depth 3 (deeper nodes stay at 3 with their `blocked-by`).
- Extend `apps/web/e2e/planning.spec.ts` (the tab at 390, the aside at 1280) and its scenario.

## Decisions already made

- Mockup: `planning` (page `design/screens/crewdeck/planning.html`; captures `design/screens/crewdeck/planning-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. Only the « Arbre des Tickets ouverts » card and its tab are this ticket's.
- Closed Tickets are not in the tree; a closed blocker no longer links.
- The tree is drawn from GitHub's native blocked-by only (BOUCLE-1).

## Acceptance criteria

- [ ] With #51 → #56 → #57 and #38 → #58, `ticketTree` returns two roots, depths 0/1/2 and 0/1, and marks #51, #56, #57 critical (unit test).
- [ ] A Ticket with two open blockers appears once, under the first by the Boucle's order, with « bloqué par » the other.
- [ ] Closing a blocker re-roots its dependents without reload.
- [ ] Clicking a node opens the Ticket's page.
- [ ] At 390 the tab shows the tree, at 1280 the card stands beside the planning; both match the mockup (Playwright, axe without violations); the captures come from those tests.

## Verification

- `pnpm exec nx test web -- src/views/ticket-tree.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/ticket-tree-card.spec.ts`
- `pnpm exec nx e2e web -- planning.spec.ts`
- `scripts/captures.sh apps/web/e2e/planning.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The milestones and estimates: PILOTAGE-1.
- Editing dependencies from the tree: not in the PRD.

## Dependencies

- PILOTAGE-1
