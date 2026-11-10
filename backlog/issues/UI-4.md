---
id: UI-4
title: "Form Composants and Dialog: TextField, Select, Toggle, Checkbox, Radio, SettingRow, Dialog"
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

The forms of the product (an Idée noted, the Paramètres, a comment asking for changes) and its dialogs are Composants a Skin may replace (US-23). ADR 0006 « Consequences »: accessibility by hand, native inputs and `<dialog>` inside the shadow roots, `ElementInternals` for form Composants. `design/DESIGN.md` « Forms », « Overlays », « Interactive states » (error: the field's border and help in `halt`, the message under it). PARAM-1 to PARAM-4 build on `SettingRow`, IDEE-1 on `TextField`, CORE-7 on `Dialog`'s look; the library page gets its search field and its phone `Select` here.

## Current state of the code

- Created by UI-1: `defineComposant`, the registry, `PasserelleElement`, `t()`.
- Created by UI-2: Icon, Button, IconButton, Card, the library page `PageComposants` (`/parametres/composants`) and its generated examples test.
- `design/components.js` (`ui-text-field`, `ui-select`, `ui-toggle`, `ui-checkbox`, `ui-radio`, `ui-setting-row`, `ui-dialog`): the drawn reference.

## To do

- Declarations in `packages/contracts/src/composants/`, implementations in `packages/skin-passerelle/src/`, each with examples:
  - **TextField** `cd-text-field` (category `signal`): data `{ name, label, value, placeholder: string | null, help: string | null, error: string | null, state: 'disabled' | null, multiline: boolean, maxLength: number | null }`; an `<input>` or a `<textarea>` (height `--cd-text-area`), form-associated (`static formAssociated = true`, `ElementInternals.setFormValue`, `setValidity` from `error`); `error` shown under the field in `halt` and linked by `aria-describedby`; examples default, error, multiline, disabled.
  - **Select** `cd-select`: data `{ name, label, value, options: { value, label, disabled: boolean }[], help: string | null, state: 'disabled' | null }`; a native `<select>`, form-associated.
  - **Toggle** `cd-toggle`: data `{ name, label, checked: boolean, help: string | null, state: 'disabled' | null }`; `role="switch"`, form-associated; examples on, off, disabled.
  - **Checkbox** `cd-checkbox`: data `{ name, label, checked }`. **Radio** `cd-radio`: data `{ name, value, label, checked }`; native inputs.
  - **SettingRow** `cd-setting-row` (category `partie`): data `{ label, help: string | null, origin: 'compte' | 'projet' | null }`; slot `default` (the control); shows `settingRow.inherited` « Hérité du compte » or `settingRow.changed` « Modifié pour ce Projet » when `origin` is set; examples inherited, changed, none.
  - **Dialog** `cd-dialog` (category `partie`): data `{ open: boolean, title }`; slots `default` (body), `actions`; action `close {}` (the « Fermer » `IconButton`, Escape, a click on the scrim); a native modal `<dialog>` with `aria-labelledby` on its title, width `--cd-dialog-width` at 1280, full screen at 390, scrim `--cd-scrim`; focus moves into it on open and back to the opener on close.
- Form controls declare no core action: they dispatch the native `input` and `change` events (`composed: true`) and take part in their form through `ElementInternals`, so the page Composant that holds the form reads `FormData` and emits its own domain action (« data in, actions out » stays at the page's level). Written in the declarations' descriptions.
- Library page (UI-2's `PageComposants`): at 1280 a `TextField` « Chercher un Composant » filtering the groups by name (case-insensitive, accents ignored); at 390 a `Select` « Composant » listing every Composant as `<Name> · <group>` instead of the groups, selecting it updates `?c=`. Copy `composants.page.search` « Chercher un Composant », `composants.page.select` « Composant ».
- `t()` keys `composants.<Name>.*` for each new declaration (descriptions, fields, slots, actions), as UI-2's test requires.
- Playwright `apps/web/e2e/composants-forms.spec.ts`: the library page with `?c=TextField`, `?c=SettingRow`, `?c=Dialog` at 390 and 1280 px, keyboard use of each control, axe.

## Decisions already made

- Mockup: `composants` (page `design/screens/crewdeck/composants.html`; captures `design/screens/crewdeck/composants-390.png`, `…-1280.png`), and for the controls the library drawing `design/components.html`. It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- Controls' borders use `--cd-control-border` (3:1 on `panel` and `side`), focus-visible a 2 px `accent` outline with a 2 px offset.
- `Dialog` is a Composant a Skin may replace; the confirmation of an Action sensible is not (`crewdeck-confirm`, CORE-7).
- No custom dropdown: `Select` is the native `<select>` (accessibility, phone pickers).

## Acceptance criteria

- [ ] Each example of the seven Composants renders (UI-2's generated test).
- [ ] A `<form>` containing a TextField, a Select and a Toggle submits their values in its `FormData`; a TextField with `error` reports itself invalid to the form and shows the message under it, linked by `aria-describedby`.
- [ ] Toggle has `role="switch"` and `aria-checked`; Space toggles it.
- [ ] Dialog: opening moves focus inside; Escape and « Fermer » emit `close`; focus returns to the opener.
- [ ] SettingRow shows « Hérité du compte » or « Modifié pour ce Projet » by `origin`.
- [ ] The library page filters by search at 1280 and switches through the Select at 390; axe without violations at both widths.

## Verification

- `pnpm exec nx test skin-passerelle -- src/text-field.spec.ts src/dialog.spec.ts`
- `pnpm exec nx test skin-passerelle`
- `pnpm exec nx e2e web -- composants-forms.spec.ts`
- `scripts/captures.sh apps/web/e2e/composants-forms.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- `crewdeck-confirm`: CORE-7. The Composer of a Session: UI-7.
- The Paramètres pages that use these controls: PARAM-1 to PARAM-4.

## Dependencies

- UI-2.
