---
id: CORE-7
title: "Actions sensibles: the core's crewdeck-confirm dialog and the server's freshness check"
epic: CORE
type: feature
priority: P0
size: M
milestone: M1 Socle
blocked_by: [CORE-6, UI-4]
adr: [0002, 0006, 0007]
risques: [SEC-5]
stories: [US-26]
screens: []
revue_visuelle: true
video: false
---

## Context

US-26: « As a Pilote, I want an Action sensible (merge, start the Boucle, approve a document of a Conception or the inventory of a repository) asked by any Skin to be confirmed in a dialog of the product itself, so that no Skin can act behind my back. » ADR 0006: the product's dialogs live outside the Composants' registry so that no Skin replaces them — `crewdeck-confirm`, with its « Confirmé par Crewdeck » mark; the core validates every `cd-action` and opens its confirmation first for an Action sensible (risk SEC-5). ADR 0007: during the Resynchronisation every Action sensible is disabled; a command carrying an older `seq` than the resource's last change gets 409. ADR 0002: every gate is bound to what the Pilote saw. This ticket builds the mechanism; each Action sensible's ticket (PROJET-5, BOUCLE-2, BOUCLE-4, BOUCLE-6, BOUCLE-8, CONCEPTION-4, CONCEPTION-6, CONCEPTION-10) declares its action, its consequences and its confirmation state.

## Current state of the code

- Created by UI-1: `defineComposant` (actions as zod schemas), the root `cd-action` listener and dispatcher (`apps/web/src/actions/`), the in-page bridge, `t()`.
- Created by UI-4: `Dialog`, `Button` variants (UI-2).
- Created by CORE-6: the store, `sensitiveBlockedReason(state)`, `apps/web/src/api/client.ts` sending `seq`, the Cadre's banner Emplacement.
- Created by CORE-5: `assertFresh`, `withSeq`, `realtime.stale`.
- No Action sensible, no confirmation dialog.

## To do

- `packages/contracts/src/api/sensitive-actions.ts`: `zSensitiveActionId` = `merge | loop.start | schedule.create | schedule.resume | document.approve | inventory.approve`.
- `packages/sdk`: `sensitive(id, schema)` to declare a Composant's action as sensitive (`actions: { approve: sensitive('document.approve', z.object({ id: zId })) }`); the declaration keeps `{ schema, sensitive: id }` and the library page (UI-2) shows the badge « Action sensible » for it.
- `apps/web/src/dialogs/confirm.ts`: the custom element `crewdeck-confirm` (Lit, shadow DOM, defined by the core at boot, **not** a `cd-*` tag and absent from the registry and from `@crewdeck/sdk`'s exports), a native modal `<dialog>` with `role="alertdialog"`: the mark (icon `shield`, `confirm.mark` « Confirmé par Crewdeck · Action sensible »), the title, the consequences (a paragraph, a list with bold leads, a closing paragraph, as structured data `{ lead?, items?: { strong, text }[], note? }` — never HTML from a Skin), « Annuler » (`confirm.cancel`, ghost) and the action's button (primary, or `danger` when asked, its icon). Escape and « Annuler » resolve `false`; focus goes to « Annuler » on open and back to the opener on close. Its styles use the `--cd-*` tokens and are not restylable by `part`s.
- `confirmSensitiveAction({ action: SensitiveActionId, title, confirmLabel, icon?, tone?, consequences }) → Promise<boolean>`, exported from `apps/web/src/dialogs/confirm.ts`.
- Dispatcher (`apps/web/src/actions/dispatcher.ts`): handlers register with `registerAction(composant, action, { run, confirmation? })`. For a sensitive action:
  - registering without `confirmation(payload, state) → { title, confirmLabel, icon?, tone?, consequences }` throws at boot;
  - while `sensitiveBlockedReason(state)` is not null the action is refused (no dialog), its reason announced through an `aria-live` region of the Cadre;
  - otherwise the dispatcher captures the store's `seq`, opens the dialog, and on confirm calls `run(payload, { seq })` with that captured `seq` (the state the Pilote confirmed on).
- `apps/server/src/sensitive-actions/`:
  - `sensitive-action.decorator.ts`: `@SensitiveAction(id)` on a command route; its body schema must include `seq` (`withSeq`), else the app fails at boot;
  - `sensitive-actions.service.ts`: `assertFresh(lastSeq, commandSeq)` → 409 `sensitive-action.stale`, « L'état a changé pendant que tu confirmais : vérifie et confirme de nouveau. »; it marks the request as checked;
  - `sensitive-action.interceptor.ts`: after the handler, outside production, fails with 500 when a `@SensitiveAction` route did not call `assertFresh` (so a forgotten check breaks the route's own test); logs `{ action, pilotId, resourceId }` at `info`, never the body.
- The library page (UI-2's `apps/web/src/views/composants.ts`) lists `ConfirmDialog` in « Signaux et contrôles » with the meta `composants.confirmDialog.meta` « fourni par le produit, non remplaçable », and no preview.
- Test harness: outside production, `window.__crewdeck.confirm(options)` opens the dialog (for Playwright); `apps/web/e2e/confirm-dialog.spec.ts` captures it at 390 (full screen) and 1280 px with a three-part consequence, axe without violations.

## Decisions already made

- No mockup of its own: the look is the `ConfirmDialog` of `design/components.js` / `components.css` as drawn in `design/screens/crewdeck/boucle-confirmation-demarrage.html` (the mark above the title, « Annuler » then the primary action). Each Action sensible's ticket cites its own confirmation state.
- The Skin may ask, never confirm: the handler registry and `confirmSensitiveAction` are core-only modules that `@crewdeck/sdk` does not export (ESLint boundaries of UI-1 already forbid the Skin to import `apps/web`).
- The server cannot see the page's dialog; what it enforces is freshness: the command carries the `seq` captured when the dialog opened, and any change of the resource since then is a 409.
- Starting the Boucle or a Planification is one confirmation that covers its later merges (PRD « Principles »): those merges are not new Actions sensibles; BOUCLE-2 and BOUCLE-8 record the consent.

## Acceptance criteria

- [ ] A Composant emitting a sensitive `cd-action` opens `crewdeck-confirm`; « Annuler » or Escape runs nothing; confirming runs the handler once with the `seq` captured at opening.
- [ ] During the Resynchronisation the same action opens no dialog and runs nothing; its reason is announced.
- [ ] Registering a sensitive action without `confirmation` throws at boot.
- [ ] `crewdeck-confirm` is not in the registry: a Skin defining a Composant named `ConfirmDialog` or the tag `crewdeck-confirm` does not replace it (the core defines its tag before the Skin's).
- [ ] Server: a `@SensitiveAction` route without `seq` → 400 `validation.invalid` on `seq`; with a stale `seq` → 409 `sensitive-action.stale`; a test route that skips `assertFresh` fails its test with 500.
- [ ] Playwright: the dialog at 390 and 1280 px, axe without violations, focus returned to the opener.

## Verification

- `pnpm exec nx test web -- src/dialogs/confirm.spec.ts src/actions/dispatcher.spec.ts`
- `pnpm exec nx test server -- src/sensitive-actions/`
- `pnpm exec nx e2e web -- confirm-dialog.spec.ts`
- `scripts/captures.sh apps/web/e2e/confirm-dialog.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- Each Action sensible's command, its consequences' copy and its confirmation screen: the tickets listed in « Context ».
- The Appareil's approval dialog, the other dialog outside the registry: E2E-3.
- Skins in a sandboxed iframe (Bêta, ADR 0006).

## Dependencies

- CORE-6.
- UI-4.
