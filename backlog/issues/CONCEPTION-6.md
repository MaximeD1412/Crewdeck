---
id: CONCEPTION-6
title: "Reviewing the mockups of a Conception: captures by screen, remarks, approve or ask for changes"
epic: CONCEPTION
type: feature
priority: P1
size: M
milestone: M6 Conception
blocked_by: [CONCEPTION-5]
adr: [0002, 0003, 0006, 0008]
risques: []
stories: [US-11, US-26]
screens: [revue-maquettes, revue-maquettes-confirmation]
revue_visuelle: true
video: false
---

## Context

US-11 for the mockups: the Pilote reviews a set of mockups screen by screen and approves it (merging the design PR, an Action sensible, US-26) or asks for changes with remarks per screen, which the `visual-design --fix` Session takes up. The captures live in the Projet's repository and are read by the browser from GitHub (ADR 0002, ADR 0003).

## Current state of the code

- Created by CONCEPTION-4: `POST /api/designs/:id/steps/:step/approve` and `request-changes` (generic for `mockups`), the comment posted by the browser, the remarks pattern of `PageRelecture`.
- Created by CONCEPTION-5: the `mockups` Étape, its PR, `zScreensIndex` (`packages/contracts/src/design/screens.ts`).
- Created by UI-6: `Capture`; by UI-2: `Tabs`, `Chip`, `ListRow`, `Card`.
- No mockups review page.

## To do

- `/conceptions/:id/maquettes`: `apps/web/src/views/revue-maquettes.ts`, Composant `PageRevueMaquettes` (`packages/contracts/src/composants/page-revue-maquettes.ts`, skin implementation) with `examples`.
- Reading, by the browser with the user token, at the `DesignStep`'s `headSha`: `design/screens.json` (contents API, parsed with `zScreensIndex`), then the PNGs of the selected screen (contents API with `Accept: application/vnd.github.raw`, turned into object URLs, revoked on leave), through `@tanstack/query-core` keyed by repository + SHA + path. Only the screens the PR adds or changes (the PR's files list) are shown, in `screens.json`'s order.
- The page: header « Maquettes · <title> », « <Projet> · N écrans · PR #n », back to the Conception; one tab per screen and state of the PR; the card of the selected one (its stories, « état nominal » or the state's title, chips « 390 » / « 1280 » choosing the capture shown, both side by side at 1280 px); « Écrans » listing them with their stories and remark count; « Remarques sur cet écran » (`Message`s and a `TextField` « Ce qui doit changer sur cet écran », kept in the tab's memory).
- « Demander des changements »: one PR comment posted by the browser, remarks grouped under « **Sur <screen id>** » headings, then CONCEPTION-4's `request-changes` with its id.
- « Approuver les maquettes »: Action sensible `document.approve`; consequences « Crewdeck va : merger la PR #n des maquettes dans <integration branch> ; démarrer l'Étape Conception technique avec le Moteur du Rôle Conception (<Moteur>). Tu relis ensuite la conception technique depuis « À toi ». »; calls CONCEPTION-4's `approve` with `step: 'mockups'` and the head SHA.
- The `document-review` Décision of the `mockups` Étape opens this page.
- Copy under `t('revueMaquettes.*')`.
- Tests and scenarios: `apps/server/src/testing/scenarios/revue-maquettes.ts` (the fake GitHub holding a `screens.json` of three screens and their PNGs at a SHA), `apps/web/e2e/revue-maquettes.spec.ts`.

## Decisions already made

- Mockup: `revue-maquettes`, `revue-maquettes-confirmation` (pages `design/screens/crewdeck/revue-maquettes.html`, `…/revue-maquettes-confirmation.html`; captures `design/screens/crewdeck/revue-maquettes-390.png`, `…-1280.png` and the same for the state). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- Captures are fetched through the contents API with the user token (raw URLs of a private repository need it), never proxied by the server.
- Remarks are per screen in the page, one comment on the PR when sent (the dotfiles visual review's « **Sur … » format, which the `--fix` Skill parses).

## Acceptance criteria

- [ ] The page lists the PR's three screens as tabs, shows the 390 and 1280 px captures read from the (fake) GitHub at the head SHA; the server reads none of them.
- [ ] A remark added on « Notifications » counts « 1 remarque » in « Écrans »; « Demander des changements » posts one comment grouping the remarks by screen and starts the `--fix` run.
- [ ] « Approuver les maquettes » opens the product's confirmation; confirming merges the PR with the head SHA and starts the Conception technique.
- [ ] A head moved since the page loaded refuses the approval with `designs.head-moved` and the page asks to reload.
- [ ] Playwright at 390 and 1280 px on both states, axe without violations.

## Verification

- `pnpm exec nx test web -- src/views/revue-maquettes.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/page-revue-maquettes.spec.ts`
- `pnpm exec nx e2e web -- revue-maquettes.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`
- `scripts/captures.sh` for `revue-maquettes`, `revue-maquettes-confirmation`.

## For prod

Nothing.

## Out of scope

- The visual review of a Ticket's captures: BOUCLE-6.
- Comparing the delivered screens with the mockups: US-85 (Lancement).

## Dependencies

- CONCEPTION-5.
