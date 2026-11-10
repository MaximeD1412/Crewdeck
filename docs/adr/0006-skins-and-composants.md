# Composants are web components: data in, actions out, Emplacements as slots

> **Status:** accepted, 2026-11-10.

## Context

The **Skin** is the product's central bet: a **Moddeur** reshapes the screen
from one colour to the whole page by replacing **Composants** (US-23,
US-41 to US-43), the core keeping the logic and confirming every **Action
sensible** in its own dialog (US-26). At the MVP there is one Skin, the
default « Passerelle » (`design/DESIGN.md`); third-party Skins come with
the Bêta, and the three official Skins must use the public library only.
The mockups are already custom elements (`ui-*`, named slots, `data-name`),
never imported by the implementation.

The founder asked whether web components give Moddeurs more freedom than
React. They do: with React, replacing one Composant inside a parent Skin
means writing React; with custom elements, the contract is the browser's
own, and a Moddeur writes one Composant in Lit, Svelte, Vue, React or plain
JS without the parent Skin caring.

## Decision

### A Composant's contract

Each **Composant** is declared in `packages/contracts/src/composants/`:

```ts
export const DecisionRow = defineComposant({
  name: 'DecisionRow', version: 1, tag: 'cd-decision-row',
  data: z.object({ kind: zDecisionKind, title: z.string(), meta: z.string(), tone: zTone }),
  actions: { open: z.object({ id: zId }), act: z.object({ id: zId, action: z.string() }) },
  slots: ['actions'],
  examples: [/* fixtures for the preview and the tests */],
});
```

- **Data in**: the element's `data` property, set by the core (a page) or
  by the Composant that places it (a row in a list). A Composant decides
  nothing: what it shows comes from `data`.
- **Actions out**: a `cd-action` `CustomEvent` (`bubbles`, `composed`,
  `detail: { composant, action, payload }`). The core listens at the root,
  validates the payload against the declaration and runs it; an **Action
  sensible** opens the core's confirmation first.
- **Emplacements** are native named `<slot>`s of the element's shadow root.
- **Look**: shadow DOM; the tokens are CSS custom properties (`--cd-*`, the
  values of `design/tokens.css`), which cross shadow roots, so a **Thème**
  (US-22) is a set of properties; each Composant exposes `part`s for finer
  restyling.
- Pages and the **Cadre** are Composants too (`Cadre`, `PageAToi`,
  `PageIdees`…): everything on screen is replaceable (US-23).

### A Skin

```ts
export default defineSkin({
  id: 'passerelle', parent: null, targets: ['pc', 'telephone'],
  composants: { DecisionRow: PasserelleDecisionRow, /* … */ },
});
```

- At boot the core merges the Skin with its parents (a child's Composant
  wins) and defines each implementation under its canonical `cd-*` tag. One
  Skin per page load; changing Skin reloads.
- A Skin imports only `@crewdeck/sdk` (the contracts, `defineSkin`, `t()`
  for the copy, the formatters) and its own dependencies. Nx module
  boundaries (`scope:skin` may depend on `scope:sdk` only) and an ESLint
  `no-restricted-imports` enforce it for `packages/skin-passerelle`.
- Lit 3 for the default Skin and the core's own elements; nothing obliges a
  Moddeur to use it.

### The core

`apps/web` is plain TypeScript and a few Lit elements of its own:

- the store fed by the real time ([ADR 0007](0007-real-time.md)), and one
  pure function per page (`apps/web/src/views/<page>.ts`) that turns the
  store into the page Composant's `data`;
- the router (French paths, [ADR 0008](0008-conventions.md)), which maps
  a URL to a page Composant;
- the keys ([ADR 0003](0003-privacy-and-end-to-end-encryption.md));
- the product's dialogs, outside the registry, so that no Skin replaces
  them: `crewdeck-confirm` (the **Action sensible**'s confirmation with its
  « Confirmé par Crewdeck » mark) and the Appareil's approval.

### The bridge, and isolation

- The SDK talks to the core through one interface, the bridge: data
  subscriptions in, actions out. At the MVP its implementation is in-page:
  the default Skin is first-party and runs in the top document.
- **From the Bêta**, a Skin that is not official runs in a sandboxed
  iframe on another origin (`skins.<domain>`, `sandbox="allow-scripts"`,
  CSP `connect-src 'none'`): it never sees the session cookie, the keys nor
  the network. The bridge's second implementation carries the same messages
  over `postMessage`; the Skin's code does not change. The confirmation
  dialog stays in the top page, above the iframe.
- **The library's page** (US-23, reached from the Paramètres,
  `/parametres/composants`) is generated from the declarations: each
  Composant's data, actions, Emplacements, and a preview rendered from its
  `examples`.

## Options that lost

- **React with a registry**: agents and Moddeurs know it best, but a Skin
  that replaces one Composant must be React, and US-41's « small change,
  small Skin » becomes « small change, in our framework ».
- **React for the core, Composants as web components wrapped for React**:
  both worlds' costs.
- **Every Skin in an iframe from the MVP**: routing, focus, dialogs and
  scrolling across a frame for one first-party Skin.
- **Light DOM** (the mockups'): global CSS restyling is easy, but there are
  no native slots for the Emplacements and a Moddeur's styles leak into the
  others'.

## Consequences

- Lit has no ready-made kit: the library is ours (already drawn).
  Accessibility is done by hand: native `<dialog>` and inputs inside the
  shadow roots, `ElementInternals` for form Composants, axe in the
  Playwright tests.
- A Composant's contract carries its version from day one, so US-43 (next)
  adds compatibility ranges without changing the shape.
- The first files to imitate: `packages/contracts/src/composants/decision-row.ts`,
  `packages/skin-passerelle/src/decision-row.ts`, `apps/web/src/views/a-toi.ts`.
