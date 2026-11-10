---
id: UI-3
title: "The Cadre: sidebar, phone header and tab bar, menu « Plus », Runner status, bare variant"
epic: UI
type: feature
priority: P0
size: M
milestone: M1 Socle
blocked_by: [UI-2]
adr: [0006, 0008]
risques: []
stories: [US-23]
screens: [a-toi-menu-plus, composants]
revue_visuelle: true
video: false
---

## Context

The **Cadre** is the Composant that lays out the whole page: where the menu, the page and « À toi » go (glossary). US-23 asks for the Cadre and each item of its menu to be Composants a Skin may replace; the Cadre's menu is one of its Emplacements (glossary « Emplacement »). `design/DESIGN.md` « Layout »: at 390 a top bar (brand, Runner state) and a tab bar (À toi, Idées, Conceptions, Boucle, Plus); at 1280 a sidebar with the same entries and the Runner's state at its foot; a Session opens as a right panel (full screen at 390); dialogs go to the overlay. Every page ticket renders inside it; CORE-4 uses its `bare` variant for `/connexion`, CORE-6 fills its status and banner.

## Current state of the code

- Created by UI-1: the registry, the router (page Composants mounted by URL), `t()`, the `PasserelleElement` base.
- Created by UI-2: Icon, Button, IconButton, StatusDot, Card, ListRow, the library page `/parametres/composants`.
- `design/components.js` (`ui-app-shell`, its `NAV` and `RUNNER` tables) and `design/components.css` (`.shell*`): the drawn reference.

## To do

- **Cadre** `cd-cadre` (`packages/contracts/src/composants/cadre.ts`, category `cadre`):
  - data `{ variant: 'default' | 'bare', current: NavId | null, screenLabel: string, status: 'online' | 'offline' | 'resync', statusDetail: string | null, live: boolean, pilot: { login, avatarUrl: string | null } | null }`, `NavId` = `a-toi | idees | conceptions | boucle | planning | statistiques | projets | runner | parametres`;
  - slots `menu` (the `MenuItem`s), `default` (the page), `banner` (above the page), `panel` (a right panel at 1280, full screen at 390), `overlay` (a dialog);
  - action `openPilot {}` (the avatar at the sidebar's foot → `/parametres`).
- **MenuItem** `cd-menu-item` (category `cadre`): data `{ id: NavId, label, icon: IconName, href, current: boolean, count: number | null, meta: string | null, primary: boolean }` (`primary`: one of the four entries of the phone's tab bar). Rendered as a link in the sidebar, a tab in the tab bar (only `primary` ones, the count only on « À toi »), a `ListRow`-like line with its `meta` in the « Plus » sheet.
- Layout (`packages/skin-passerelle/src/cadre.ts`):
  - 1280 (`@media (min-width: 1280px)`): sidebar `--cd-sidebar-width` on `--cd-side`, brand (icon `mark` + « CREWDECK » in `brand` type), the first four entries, a separator, the five others, at its foot the status (dot + label + detail), « En direct » (accent pulsing dot) when `live` and `online`, and the Pilote's avatar and login; the page `space-10` from it, at most `--cd-page-max`; the `panel` slot as a right panel `--cd-panel-width`;
  - 390: top bar `--cd-header-height` (brand, status: « En direct » when live, else the status label), tab bar `--cd-tab-bar` at the bottom with the four `primary` entries and « Plus »; « Plus » opens a native modal `<dialog>` titled « Plus » listing the five other entries with their `meta`, a close `IconButton` (« Fermer »), Escape closes; the `panel` slot covers the screen;
  - `bare`: only the brand on top, the page centred (sign-in, getting started);
  - landmarks: `nav` « Menu », `header`, `main`, `aside` for the panel, `aria-current="page"` on the current entry; touch targets `--cd-touch` at 390.
- Status copy `cadre.status.online` « Runner en ligne », `cadre.status.offline` « Runner hors ligne », `cadre.status.resync` « Resynchronisation… », `cadre.status.resyncDetail` « Actions sensibles indisponibles », `cadre.live` « En direct », `cadre.more` « Plus », `cadre.close` « Fermer »; entries `cadre.menu.<id>.label` (« À toi », « Idées », « Conceptions », « Boucle », « Planning », « Statistiques », « Projets », « Runner et Comptes IA », « Paramètres ») and static metas `cadre.menu.planning.meta` « Jalons et arbre des Tickets », `.statistiques.meta` « Délai, réussite de la Boucle, coût », `.parametres.meta` « Rôles, notifications, Planifications ».
- `apps/web/src/views/cadre.ts` (pure): `(state, route) → { cadre data, menu items }`: `current` from the route, `pilot` from the `pilot` slice; `status`, `statusDetail`, the counts and the dynamic metas of Projets and Runner come from slices later tickets register (CORE-6 the Resynchronisation, RUNNER-2 the Runner, ATOI-1 the Décisions count, PROJET-2 and RUNNER-7 the metas); with no slice they are `offline`, `null`, `null`.
- `apps/web/src/shell.ts`: the core mounts one `cd-cadre` for the app's life, fills its `menu` slot with `cd-menu-item`s, and puts the router's page element in its default slot; `/connexion` and `/demarrage` use `variant: 'bare'`.
- The library page (UI-2) now renders inside the Cadre with `current: 'parametres'`.
- Examples for both Composants (default with counts, offline, resync, bare; a current and a `primary` MenuItem), on the library page.
- Scenario `apps/server/src/testing/scenarios/menu-plus.ts`, Playwright `apps/web/e2e/cadre.spec.ts`: the sidebar at 1280, the tab bar and the open « Plus » sheet at 390, keyboard navigation, axe.

## Decisions already made

- Mockup: `a-toi-menu-plus`, `composants` (pages `design/screens/crewdeck/a-toi-menu-plus.html`, `design/screens/crewdeck/composants.html`; captures `design/screens/crewdeck/a-toi-menu-plus-390.png`, `…-1280.png`, `design/screens/crewdeck/composants-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The « À toi » page under the « Plus » sheet is ATOI-1's; this ticket's captures show the Cadre around the library page.
- The « Plus » sheet is the Cadre's own native `<dialog>`, not UI-4's `Dialog` Composant (built in parallel), so that a Skin replacing `Dialog` does not change the menu.
- The menu's entries are fixed by the core (the Process's pages); a Skin may restyle or reorder them through the `menu` Emplacement (US-42 is Bêta), never add a page.
- Counts appear in the sidebar for À toi, Idées, Conceptions and Boucle; on the phone only on « À toi » (the mockup).

## Acceptance criteria

- [ ] At 1280 px the sidebar shows the nine entries in the mockup's order with the separator, the current one marked `aria-current="page"`, the status and the Pilote at its foot.
- [ ] At 390 px the tab bar shows À toi, Idées, Conceptions, Boucle and Plus; « Plus » opens the sheet with the five other entries and their metas; Escape and « Fermer » close it and return focus.
- [ ] `status: 'resync'` shows « Resynchronisation… » with « Actions sensibles indisponibles »; `offline` shows « Runner hors ligne » in `halt`.
- [ ] The `panel` slot is a right panel at 1280 and covers the screen at 390; `bare` shows only the brand and the page.
- [ ] Every example of Cadre and MenuItem renders (the generated test of UI-2); the library page lists both under « Cadre et menu ».
- [ ] Playwright at 390 and 1280 px, axe without violations.

## Verification

- `pnpm exec nx test skin-passerelle -- src/cadre.spec.ts`
- `pnpm exec nx test web -- src/views/cadre.spec.ts`
- `pnpm exec nx e2e web -- cadre.spec.ts`
- `scripts/captures.sh apps/web/e2e/cadre.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The Resynchronisation banner and status values: CORE-6. The Runner's presence: RUNNER-2. The Décisions count: ATOI-1.
- The pages behind each entry: their tickets.
- Reordering or emptying the Emplacements from a Skin's settings (US-42, US-84, Bêta).

## Dependencies

- UI-2.
