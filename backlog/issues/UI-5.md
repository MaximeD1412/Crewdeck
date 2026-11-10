---
id: UI-5
title: "Row Composants: DecisionRow, IdeaRow, TicketRow, AgentRow"
epic: UI
type: feature
priority: P0
size: M
milestone: M1 Socle
blocked_by: [UI-2]
adr: [0006]
risques: []
stories: [US-23]
screens: [composants]
revue_visuelle: true
video: false
---

## Context

The rows of the product's lists are Composants a Skin may replace (US-23: « their blocks (a Ticket's card, an agent session) »): a Décision in « À toi » (ATOI-1), an Idée in the Idées (IDEE-1), a Ticket in the Boucle, the planning and a Conception (BOUCLE-2, PILOTAGE-1), an agent at work in « Boucles en cours » (BOUCLE-3). `design/DESIGN.md` « Rows and cards »: state is carried by a left rail, a tinted icon box and a status badge, never by a coloured surface; rows of 56 to 72 px. ADR 0006's own example is `DecisionRow`.

## Current state of the code

- Created by UI-1: `defineComposant`, `PasserelleElement`, `t()`, the formatters.
- Created by UI-2: Icon, StatusBadge, Button, Card, ListRow, the library page and its generated examples test.
- `design/components.js` (`ui-decision-row`, `ui-idea-row` with its `IDEA` states, `ui-ticket-row` with its `TICKET` states, `ui-agent-row`) and `design/components.css` (`.row*`): the drawn reference.

## To do

- Declarations in `packages/contracts/src/composants/`, implementations in `packages/skin-passerelle/src/`, category `partie`, each with examples:
  - **DecisionRow** `cd-decision-row`: data `{ id: zId, kind: string, title, meta, context: string | null, tone: 'accent' | 'go' | 'caution' | 'halt' | 'neutral', icon: IconName }`; slots `actions` (the Décision's buttons, placed by the page), `badges` (signals beside the title); action `open { id }` (a click on the row outside its actions). `kind` is the kind's label (« Ticket bloqué »), computed by the view from the Décision's `kind` (ATOI-1 owns `zDecisionKind`). Examples: the nine rows of the « À toi » mockup (Ticket bloqué/halt/block, Permission demandée/caution/shield, Question de l'agent/accent/info, Limite atteinte/caution/gauge with two actions, Revue visuelle/accent/eye, Conception à relire/accent/doc, Ticket interrompu/caution/bolt, Inventaire à approuver/accent/folder, Contrat incomplet/caution/contract).
  - **IdeaRow** `cd-idea-row`: data `{ id, title, meta, state: 'en-analyse' | 'a-trier' | 'analysee' | 'retenue' | 'fusionnee' | 'rejetee', summary: string | null, impact: string | null, effort: string | null, duplicates: string | null, selected: boolean }`; slot `actions`; action `open { id }`; badge labels `ideaRow.state.<state>` (« En analyse », « À trier », « Analysée », « Retenue », « Fusionnée », « Rejetée ») with the tones of the mockup's `IDEA` table; facts « Impact … », « Effort … » and the duplicates line; icon `spark` while `en-analyse`, else `bulb`. One example per state.
  - **TicketRow** `cd-ticket-row`: data `{ number: int, title, meta: string | null, state: 'pret' | 'en-cours' | 'en-review' | 'checks' | 'bloque' | 'revue-visuelle' | 'interrompu' | 'merge' | 'attente', label: string | null, context: string | null, href: string | null }`; slot `actions`; badge `ticketRow.state.<state>` (« Prêt », « En cours », « En review », « Checks », « Bloqué », « Revue visuelle », « Interrompu », « Mergé », « En attente ») unless `label` overrides it; `#<number>` in mono; with `href` the row is a link. One example per state.
  - **AgentRow** `cd-agent-row`: data `{ sessionId: zId, projet, ticket, step, engine, since, tone: 'go' | 'accent' | 'caution' | 'halt' }`; action `open { sessionId }` (opens the Session panel, `?session=`). Examples: « en review » on Codex, « attend ta permission » in `caution` on Claude Code.
- `t()` keys `composants.<Name>.*` for the library page, and the state labels above.
- Keyboard: a row with `open` is reachable by Tab and opens on Enter; its inner buttons stay separately focusable (no nested interactive elements in the row's link).
- Playwright `apps/web/e2e/composants-rows.spec.ts`: the library page with `?c=DecisionRow`, `?c=IdeaRow`, `?c=TicketRow`, `?c=AgentRow` at 390 and 1280 px, axe.

## Decisions already made

- Mockup: `composants` (page `design/screens/crewdeck/composants.html`; captures `design/screens/crewdeck/composants-390.png`, `…-1280.png`), and the rows as drawn in `design/screens/crewdeck/a-toi.html`, `idees.html`, `boucle.html`. It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- Rows decide nothing: what a button in `actions` does is the page's; `open` only says which row was opened.
- `DecisionRow.kind` is a display label (a `string`), so that ATOI-1 can add kinds without a new version of this Composant; the enum lives in the Décisions' API contract.
- A row's metadata line (`meta`) is one string composed by the view (« Crewdeck · Code · il y a 4 min »), in the `meta` type (mono).

## Acceptance criteria

- [ ] Every example of the four Composants renders (UI-2's generated test); each `open` emits a `cd-action` with a valid payload.
- [ ] DecisionRow places the page's buttons in its `actions` slot and its signals in `badges`; Enter on the row emits `open`, Enter on a button inside does not.
- [ ] IdeaRow and TicketRow show the badge label and tone of each state; TicketRow's `label` overrides the state's label.
- [ ] Rows are 56 to 72 px tall at both widths for a one-line title, and pass axe on the library page at 390 and 1280 px.

## Verification

- `pnpm exec nx test skin-passerelle -- src/decision-row.spec.ts src/ticket-row.spec.ts`
- `pnpm exec nx test skin-passerelle`
- `pnpm exec nx e2e web -- composants-rows.spec.ts`
- `scripts/captures.sh apps/web/e2e/composants-rows.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The pages that place these rows and their actions: ATOI-1, IDEE-1, BOUCLE-2, BOUCLE-3, PILOTAGE-1.
- `TicketTree`'s nodes: UI-6.

## Dependencies

- UI-2.
