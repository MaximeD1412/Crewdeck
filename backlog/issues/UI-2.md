---
id: UI-2
title: "Library of Composants: the /parametres/composants page and the base Composants"
epic: UI
type: feature
priority: P0
size: M
milestone: M1 Socle
blocked_by: [UI-1, INFRA-4]
adr: [0006, 0008]
risques: [AGT-4]
stories: [US-23]
screens: [composants]
revue_visuelle: true
video: false
---

## Context

US-23: « As a Moddeur, I want a documented library of Composants that covers everything on screen, from the Cadre of the page and each item of the menu to whole pages, their blocks and the smallest elements, each with its data, actions, Emplacements and a preview, in a page of the product reached from the Paramètres, so that I can replace any of them. » ADR 0006: the library's page (`/parametres/composants`) is generated from the declarations: each Composant's data, actions, Emplacements, and a preview rendered from its `examples`. This ticket builds that page and the first family of Composants, the base controls and signals every screen uses; UI-3 to UI-7 add their families, which appear on this page by themselves and are reviewed through it (risk AGT-4: every Composant has tested examples to imitate).

## Current state of the code

- Created by UI-1: `defineComposant` (`packages/contracts/src/composants/define.ts`, categories `cadre | page | partie | signal`), `COMPOSANTS`, `defineSkin`, `emitAction`, `t()` and `fr.ts`, the formatters, the registry, the dispatcher, the router (`PageIntrouvable`), `packages/skin-passerelle` (`PasserelleElement`, `src/tokens.css`, fonts).
- Created by INFRA-4: Playwright at 390 and 1280 px with axe, the scenarios mechanism, `scripts/captures.sh`.
- `design/DESIGN.md` « Components » and « Interactive states »: the catalogue and its states; `design/components.js` / `components.css`: their drawn reference.

## To do

- One declaration per Composant in `packages/contracts/src/composants/<kebab>.ts`, one implementation per Composant in `packages/skin-passerelle/src/<kebab>.ts` (a `PasserelleElement`), each with at least the examples named below, all exported through `COMPOSANTS` and the Skin. Category `signal` unless said:
  - **Icon** `cd-icon`: data `{ name: IconName, size: 'md' | 'sm' }`; `IconName` = every name of the `P` map of `design/components.js` (alert, arrow-left, bell, block, bolt, bulb, calendar, chart, check, chevron-right, … x, including `mark`, `spark` and `wifi`), a zod enum in `packages/contracts/src/composants/icons.ts`; inline 24×24 stroke SVG, `currentColor`, `aria-hidden`.
  - **Button** `cd-button`: data `{ label, variant: 'primary' | 'secondary' | 'ghost' | 'danger', size: 'md' | 'sm', icon?: IconName, state?: 'disabled' | 'loading', disabledReason?: string }`; a native `<button>` in the shadow root; `disabledReason` shown beside it (DESIGN.md: an Action sensible disabled with its reason); loading keeps its width, its icon a spinner. No action: the Composant that places it emits its own.
  - **IconButton** `cd-icon-button`: data `{ icon, label }` (`label` its accessible name).
  - **StatusBadge** `cd-status-badge`: data `{ tone: 'neutral' | 'accent' | 'go' | 'caution' | 'halt', label }`.
  - **StatusDot** `cd-status-dot`: data `{ tone, pulse: boolean, label }` (`label` visually hidden).
  - **Banner** `cd-banner`: data `{ tone: 'accent' | 'go' | 'caution' | 'halt' | 'neutral', title, icon?: IconName }`; slots `default` (text), `actions`; `role="status"` (or `alert` for `halt`).
  - **Empty** `cd-empty`: data `{ icon, title }`; slots `default`, `actions`.
  - **Chip** `cd-chip`: data `{ label, count?: number, selected: boolean }`.
  - **ProjectFilter** `cd-project-filter` (category `cadre`): data `{ chips: { projectId: zId | null, label, count?: number, selected: boolean }[] }`; action `select { projectId: zId | null }` (`null` = « Tous les Projets »).
  - **Tabs** `cd-tabs`: data `{ tabs: { id, label, count?: number, selected: boolean }[] }`; action `select { id }`; arrow keys move the selection (WAI-ARIA tabs).
  - **Card** `cd-card` (category `partie`): data `{ title?: string, count?: number, label?: string }` (`label` makes it a `section` landmark); slots `default`, `actions`.
  - **ListRow** `cd-list-row` (category `partie`): data `{ title, meta?: string, icon?: IconName, tone?: Tone, href?: string }`; slot `trailing`; with `href` the row is a link the router intercepts.
  - **KeyValue** `cd-key-value` (category `partie`): data `{ items: { label, value, mono: boolean }[] }`, a `<dl>`.
  - **CodeBlock** `cd-code-block` (category `partie`): data `{ code }`; « Copier » (`codeBlock.copy`) copies to the clipboard and says `codeBlock.copied` « Copié » for 2 s — a local behaviour, no action.
  - **PageHeader** `cd-page-header` (category `cadre`): data `{ title, count?: string, back?: { label, href } }`; slot `actions`; a `header` landmark with one `h1`.
- The library page: **PageComposants** `cd-page-composants` (category `page`), route `/parametres/composants?c=<Name>`:
  - data (built by the pure view `apps/web/src/views/composants.ts` from `COMPOSANTS`): `{ groups: { category, composants: { name, version }[] }[], selected: { name, version, category, description, fields: { name, type, description }[], actions: { name, sensitive: boolean }[], slots: { name, description }[], examples: { name, data, slots? }[] } }`; action `select { name }` (updates `?c=`);
  - layout per the mockup: the groups as `Card`s of `ListRow`s (« Cadre et menu », « Pages », « Parties de page », « Signaux et contrôles »), the selected one marked with a `StatusBadge` « ouvert »; then « Aperçu » rendering each example (the real element, `data` set from the example); then the description, « Données » (a table: Nom, Type, Description), « Actions » (`ListRow`s, badge « libre » or « Action sensible »), « Emplacements »;
  - field `type` is derived from the zod schema (`string`, `number`, `boolean`, an enum's name, `X[]`); descriptions are `t()` keys: `composants.<Name>.description`, `composants.<Name>.data.<field>`, `composants.<Name>.slots.<slot>`, `composants.<Name>.actions.<action>` — a test fails when a declaration lacks one of its keys in `fr.ts`.
- Copy keys `composants.page.*`: title « Bibliothèque de Composants », back « Paramètres », groups `composants.category.cadre` « Cadre et menu », `.page` « Pages », `.partie` « Parties de page », `.signal` « Signaux et contrôles », headings « Aperçu », « Données », « Actions », « Emplacements », columns « Nom », « Type », « Description », badges « ouvert », « libre », « Action sensible ».
- Tests: `packages/skin-passerelle/src/composants.spec.ts` renders every example of every declaration in Vitest browser mode (one generated test per example, so later tickets' Composants are covered by adding examples) and asserts each action emits a valid `cd-action`; `apps/web/src/views/composants.spec.ts`; Playwright `apps/web/e2e/composants.spec.ts` with scenario `apps/server/src/testing/scenarios/composants.ts`, at 390 and 1280 px, axe without violations.

## Decisions already made

- Mockup: `composants` (page `design/screens/crewdeck/composants.html`; captures `design/screens/crewdeck/composants-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The mockup's search field and Composant `Select` come with UI-4 (their Composants); the « Placé dans » line is not built (the declarations do not record where they are placed).
- Until UI-3, the page renders without the Cadre; UI-3 places it in the Cadre with `current="parametres"`.
- The icons' path data (24×24, stroke 2, round caps) are taken from the `P` map of `design/components.js` into `packages/skin-passerelle/src/icons.ts`: they are a design asset like the tokens; nothing else of that file is copied.
- Values only from `--cd-*` tokens: a lint (`stylelint` `declaration-property-value-allowed-list` or a test grepping the Skin's CSS) refuses a raw hex colour or a px value outside the tokens in `packages/skin-passerelle/src/`.
- Controls are native elements inside shadow roots (ADR 0006 « Consequences »): `<button>`, `<a>`, `<dl>`, focus-visible a 2 px `accent` outline with a 2 px offset.

## Acceptance criteria

- [ ] Every example of the 15 Composants renders in Vitest browser mode; `ProjectFilter.select` and `Tabs.select` emit `cd-action`s whose payload matches their schema.
- [ ] `/parametres/composants` lists the Composants by category; `?c=Banner` shows Banner's preview, its fields with their types and descriptions, its Emplacements `default` and `actions`.
- [ ] A declaration without its `t()` keys fails the test suite.
- [ ] Button: `state="disabled"` with a `disabledReason` shows the reason and is not focusable as a pressable control; `loading` keeps the button's width.
- [ ] The page at 390 and 1280 px matches the mockup's structure and passes axe.

## Verification

- `pnpm exec nx test skin-passerelle`
- `pnpm exec nx test contracts -- src/composants/`
- `pnpm exec nx test web -- src/views/composants.spec.ts`
- `pnpm exec nx e2e web -- composants.spec.ts`
- `scripts/captures.sh apps/web/e2e/composants.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The Cadre and the link from the Paramètres: UI-3 (Cadre), PARAM-1 (« Pour les Moddeurs » card).
- Forms, Dialog, the search field of this page: UI-4. Rows: UI-5. Tracks and figures: UI-6. Session: UI-7.
- `crewdeck-confirm` listed as « fourni par le produit, non remplaçable »: CORE-7.

## Dependencies

- UI-1.
- INFRA-4.
