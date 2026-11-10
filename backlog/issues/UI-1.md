---
id: UI-1
title: "Skin runtime: defineComposant and defineSkin, registry, cd-action dispatcher, bridge, router, t(), formatters, tokens"
epic: UI
type: chore
priority: P0
size: M
milestone: M1 Socle
blocked_by: [INFRA-1]
adr: [0006, 0008]
risques: [SEC-5, AGT-4]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0006: everything on screen is a **Composant** declared in `packages/contracts/src/composants/` (data in, `cd-action` out, Emplacements as native slots, shadow DOM, `--cd-*` tokens); a **Skin** is `defineSkin({ id, parent, targets, composants })`; at boot the core merges the Skin with its parents and defines each implementation under its canonical `cd-*` tag; a Skin imports only `@crewdeck/sdk` (risk SEC-5); the core (`apps/web`) has the store, one view function per page, the router (French paths, ADR 0008) and the dialogs. ADR 0008: UI copy only through `t(key, params)` with English dotted keys and one catalogue `packages/sdk/src/i18n/fr.ts`; times and numbers through the SDK's formatters (`design/DESIGN.md` « Copy »). This ticket is the machinery; UI-2 writes the first Composants and the library page; every page ticket uses the router and the dispatcher.

## Current state of the code

- Created by INFRA-1: `apps/web` (Vite, TypeScript), `packages/contracts`, `packages/sdk`, `packages/skin-passerelle` as empty buildable projects with Vitest (browser mode for the web and the Skin) and Nx tags.
- `design/tokens.json` and `design/tokens.css`: the Passerelle tokens (colours, type, radii, spacing), generated from `design/DESIGN.md`'s front matter; `design/components.js`: the mockups' `ui-*` elements, a reference never imported.

## To do

- `packages/contracts/src/composants/define.ts`: `defineComposant({ name, version, tag, category, description, data, actions, slots, examples })` → a frozen declaration. `name` PascalCase; `tag` `cd-<kebab>`; `category` `cadre | page | partie | signal` (the library page's groups: « Cadre et menu », « Pages », « Parties de page », « Signaux et contrôles »); `data` a zod object; `actions` a record of zod schemas (CORE-7 adds `sensitive(id, schema)`); `slots` names; `examples` `{ name, data, slots?: Record<slot, string> }[]` (at least one, each valid against `data` — checked by `defineComposant` in tests). `packages/contracts/src/composants/index.ts` exports `COMPOSANTS` (every declaration), filled by the UI and page tickets.
- `packages/sdk/src/`:
  - `index.ts` re-exports the declarations and `defineComposant`, plus `defineSkin`, `emitAction`, `t`, the formatters, and the `Bridge` type;
  - `skin.ts`: `defineSkin({ id, parent: string | null, targets: ('pc' | 'telephone')[], composants: Record<ComposantName, CustomElementConstructor> })`;
  - `actions.ts`: `emitAction(el, composant, action, payload)` dispatches `new CustomEvent('cd-action', { bubbles: true, composed: true, detail: { composant, action, payload } })`;
  - `bridge.ts`: the `Bridge` interface (`subscribe(topic, cb) → unsubscribe`, `act(detail)`), so that ADR 0006's iframe implementation (Bêta) keeps the same contract;
  - `i18n/fr.ts` (the catalogue, a typed object of dotted keys) and `i18n/t.ts`: `t(key, params?)` with `{name}` interpolation; an unknown key throws outside production and returns the key in production;
  - `format.ts`: `formatRelative(instant, now = new Date())` (« à l'instant » under a minute, « il y a 4 min », « il y a 2 h » under a day, « hier », then « 12 nov. »), `formatHour(instant)` (« 16:40 »), `formatDay(day)` (« 12 nov. »), `formatNumber(n)` (narrow no-break space for thousands, `,` decimal), `formatPercent(n)` (« 86 % » with a no-break space), `formatEuros(cents)` (« 1,80 € »), all in the browser's time zone with `Intl`.
- `apps/web/src/`:
  - `registry.ts`: `bootSkin(skin, resolveParent)`: merges the Skin with its parents (a child's Composant wins), checks every declaration of `COMPOSANTS` has an implementation (boot error listing the missing names), then `customElements.define(decl.tag, impl)`; one Skin per page load;
  - `bridge/in-page.ts`: the MVP implementation of `Bridge` (data pushed to elements' `data` property, actions from the root listener);
  - `actions/dispatcher.ts`: one `cd-action` listener on `document`: finds the declaration by `composant`, validates `payload` against the action's schema, runs the handler registered with `registerAction(composant, action, { run })`; an unknown Composant, action or invalid payload is dropped with a `console.warn` (nothing runs);
  - `router.ts`: a table of the page URLs of ADR 0008 to their page Composant (`/a-toi` → `PageAToi`…), History API, same-origin `<a>` clicks intercepted, `navigate(path)`, params (`/idees/:id`), the `?session=<id>` query kept as a panel parameter; an unknown path renders `PageIntrouvable` (declared here, category `page`, data `{}`, text `router.notFound.title` « Cette page n'existe pas », link `router.notFound.back` « Retour à « À toi » »); the pages themselves are registered by their tickets;
  - `main.ts`: boot order: tokens, Skin, dispatcher, router.
- `packages/skin-passerelle/`:
  - `scripts/tokens.mjs` (Nx target `skin-passerelle:tokens`): reads `design/tokens.json` and writes `src/tokens.css` with every token as `--cd-<name>` on `:root`; the generated file is committed and a test fails when it is out of date;
  - fonts IBM Plex Sans, Sans Condensed and Mono self-hosted through `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-sans-condensed`, `@fontsource/ibm-plex-mono` (weights 400, 500, 600);
  - `src/index.ts`: `export default defineSkin({ id: 'passerelle', parent: null, targets: ['pc', 'telephone'], composants: { PageIntrouvable } })`, Lit 3;
  - `src/base.ts`: a `PasserelleElement` Lit base class (shadow DOM, `data` property, the tokens' shared styles, `emit(action, payload)`), so each Composant of this Skin stays small.
- Boundaries: Nx tags `scope:skin` (`skin-passerelle`) may depend on `scope:sdk` only; ESLint `no-restricted-imports` in `packages/skin-passerelle` allowing `@crewdeck/sdk`, `lit`, `@fontsource/*` and relative paths only; `scope:sdk` depends on `scope:contracts` only.

## Decisions already made

- `defineComposant` lives in `packages/contracts` (ADR 0006's declarations are contracts) and is re-exported by the SDK; the Skin never imports `packages/contracts` directly.
- Lit 3 for the default Skin and the core's own elements; nothing in the SDK depends on Lit.
- No French string in a Composant's code: every label comes from `t()` or from `data`.
- The tokens are generated from `design/tokens.json` by a script whose output is committed: `design/` is read at build time, never imported at run time.
- One breakpoint, 1280 px (`design/DESIGN.md`), as a constant `BREAKPOINT_PX` exported by the SDK for the Skins.

## Acceptance criteria

- [ ] `bootSkin` with a child Skin replacing one Composant of its parent defines the child's implementation for that tag and the parent's for the others; a missing implementation fails the boot with its name.
- [ ] A `cd-action` with a valid payload runs its handler once; an invalid payload, an unknown action and an unknown Composant run nothing.
- [ ] `defineComposant` rejects an example that does not match its `data` schema.
- [ ] Given a test route table, the router maps `/idees/018f…` to its page Composant with `{ id }`, keeps `?session=` as a panel parameter, and renders `PageIntrouvable` for `/nope`.
- [ ] `t('router.notFound.title')` returns the French copy; an unknown key throws in tests.
- [ ] Formatters: `formatRelative` gives « il y a 4 min », « hier », « 12 nov. » for the matching instants; `formatEuros(180)` is « 1,80 € »; `formatNumber(12345)` uses a narrow no-break space.
- [ ] ESLint fails on `import { x } from '@crewdeck/contracts'` and on `import '../../apps/web/…'` inside `packages/skin-passerelle`.
- [ ] `src/tokens.css` contains `--cd-accent: #5cc8dc` and every token of `design/tokens.json`.

## Verification

- `pnpm exec nx test contracts -- src/composants/define.spec.ts`
- `pnpm exec nx test sdk`
- `pnpm exec nx test web -- src/registry.spec.ts src/actions/dispatcher.spec.ts src/router.spec.ts`
- `pnpm exec nx test skin-passerelle`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The library page and the first Composants: UI-2. The Cadre: UI-3.
- The `sensitive` actions and the confirmation dialog: CORE-7.
- The store and the views' data: CORE-6.
- The iframe bridge for third-party Skins (Bêta).

## Dependencies

- INFRA-1.
