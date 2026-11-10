---
id: UI-6
title: "Tracks and figures: ProcessTrack, UsageMeter, Stat, CheckRow, Capture, TicketTree, Timeline"
epic: UI
type: feature
priority: P1
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

The Composants that draw progress and figures (US-23): the Étapes of a Conception or of a Ticket (CONCEPTION-2, BOUCLE-5), the usage of a Compte IA (RUNNER-13), the statistics (PILOTAGE-3), a PR's checks (BOUCLE-5), a capture of a visual review (BOUCLE-6), the ticket tree and the planning's milestones (PILOTAGE-1, PILOTAGE-2). `design/DESIGN.md` « Rows and cards ». Numbers in the mono family, tabular.

## Current state of the code

- Created by UI-1: `defineComposant`, `PasserelleElement`, `t()`, the formatters.
- Created by UI-2: Icon, StatusBadge, Card, the library page and its generated examples test.
- `design/components.js` (`ui-process-track` / `ui-step`, `ui-usage-meter`, `ui-stat`, `ui-check-row`, `ui-capture`, `ui-ticket-tree` / `ui-tree-node`, `ui-timeline` / `ui-timeline-row`) and `components.css`: the drawn reference.

## To do

- Declarations in `packages/contracts/src/composants/`, implementations in `packages/skin-passerelle/src/`, category `partie`, each with examples. Children of the mockups' elements become arrays in `data` (data in, ADR 0006):
  - **ProcessTrack** `cd-process-track`: data `{ direction: 'horizontal' | 'vertical', steps: { label, meta: string | null, state: 'done' | 'current' | 'todo' | 'off' | 'halt' }[] }`; an ordered list, the current step `aria-current="step"`; `off` drawn as turned off with `processTrack.off` « désactivée » (an Étape optionnelle turned off, US-10). Examples: a Conception at the mockups, one with an Étape off, one halted; vertical at 390.
  - **UsageMeter** `cd-usage-meter`: data `{ label, value: 0..100, detail: string | null, projection: string | null, tone: 'accent' | 'caution' | 'halt' | null }`; `tone` defaults to `halt` at 100, `caution` from 80, else `accent`; `role="meter"` with `aria-valuenow`. Examples: 100 « 16:40 », 62 with a projection, 30.
  - **Stat** `cd-stat`: data `{ label, value: string, unit: string | null, detail: string | null }` (the value already formatted by the view); `stat` type. Examples: « Délai Idée → merge » 3,4 j, « Réussite de la Boucle » 86 %.
  - **CheckRow** `cd-check-row`: data `{ name, state: 'passed' | 'failed' | 'running', detail: string | null, href: string | null }`; labels `checkRow.state.*` « réussi », « échoué », « en cours ».
  - **Capture** `cd-capture`: data `{ src, alt, label, size: 'sm' | 'lg' }` (`--cd-capture-w`, `--cd-capture-w-lg`); action `open { src }` (enlarge); `src` is an object URL the core built from GitHub content, never a remote URL fetched by the Composant.
  - **TicketTree** `cd-ticket-tree`: data `{ nodes: { number: int, title, state: TicketRowState, depth: int, blockedBy: string | null, critical: boolean, href: string | null }[] }` (`TicketRowState` is UI-5's); a list of tree items with their indent; `critical` in bold (« En gras : le chemin critique », the caption `ticketTree.criticalCaption`); « bloqué par #51 » (`ticketTree.blockedBy`).
  - **Timeline** `cd-timeline`: data `{ weeks: string[], today: int, rows: { label, start: int, span: int, tone: Tone, meta: string | null, detail: string | null }[] }`; at 1280 a grid of weeks with the rows' bars and a « today » marker; at 390 each row as a line (label, detail, meta) with its bar.
- `t()` keys `composants.<Name>.*` and the labels above.
- Playwright `apps/web/e2e/composants-figures.spec.ts`: the library page for each of the seven at 390 and 1280 px, axe.

## Decisions already made

- Mockup: `composants` (page `design/screens/crewdeck/composants.html`; captures `design/screens/crewdeck/composants-390.png`, `…-1280.png`), and these Composants as drawn in `design/screens/crewdeck/planning.html`, `statistiques.html`, `runner.html`, `conception.html`, `ticket.html`, `revue-visuelle.html`. It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- No chart library: the meters, the timeline and the tree are HTML and CSS with the tokens (`--cd-bar`, `--cd-chart-height`).
- Figures arrive formatted by the views (SDK formatters): these Composants never compute a figure.

## Acceptance criteria

- [ ] Every example of the seven Composants renders (UI-2's generated test); `Capture.open` emits a valid `cd-action`.
- [ ] UsageMeter's tone follows 80 and 100 when `tone` is null and exposes `role="meter"` with its value.
- [ ] ProcessTrack marks the current step `aria-current="step"` and shows « désactivée » on an `off` step.
- [ ] TicketTree indents by `depth`, shows « bloqué par » and the critical path in bold; Timeline places a row at `start` over `span` weeks.
- [ ] axe without violations on the library page at 390 and 1280 px for each.

## Verification

- `pnpm exec nx test skin-passerelle -- src/usage-meter.spec.ts src/timeline.spec.ts`
- `pnpm exec nx test skin-passerelle`
- `pnpm exec nx e2e web -- composants-figures.spec.ts`
- `scripts/captures.sh apps/web/e2e/composants-figures.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The pages and their views computing the figures: CONCEPTION-2, BOUCLE-5, BOUCLE-6, RUNNER-13, PILOTAGE-1 to PILOTAGE-3.
- Reading the captures from GitHub: BOUCLE-6.

## Dependencies

- UI-2.
