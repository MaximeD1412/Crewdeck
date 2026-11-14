---
id: CONCEPTION-6
title: "The approval gate of the mockups: captures by screen read from the code's Source, remarks, approve or ask for changes"
epic: CONCEPTION
type: feature
priority: P1
size: M
milestone: M6 Conception
blocked_by: [CONCEPTION-5]
adr: [0002, 0003, 0006, 0008, 0011, 0012]
risques: []
stories: [US-11, US-26]
screens: [revue-maquettes, revue-maquettes-confirmation]
revue_visuelle: true
video: false
reprend: 91
---

## Context

US-11 for the mockups: the Pilote reviews a set of mockups screen by screen and approves it (merging its change, an Action sensible, US-26) or asks for changes with remarks per screen, which the Maquettes Étape takes up through the gate's Retour. The refonte (PRD #169, ADRs 0011 and 0012) makes this page the review of an `approval` gate whose Entrée is Maquettes (« Revue des maquettes » in « Process Crewdeck »), run by CONCEPTION-4's handler; the captures live on the code's Source and are read by the browser, from GitHub with the user token or from the Runner through the relay (SOURCE-4's reader), never by the server (ADR 0002, ADR 0003). An absent Maquettes (a PRD without screens, CONCEPTION-5) passes this gate at once.

## Current state of the code

- No mockups review page on develop.
- Created by CONCEPTION-4: the `approval` handler for a document Entrée, `POST /api/designs/:id/gates/:stepRunId/approve` and `request-changes`, the merge on GitHub or Local, the review page's remarks pattern (`PageRelecture`), `ticket-comments.ts` writing the remarks comment on the change for either Source.
- Created by CONCEPTION-5: the `mockups` Étape, its change, `zScreensIndex` (`packages/contracts/src/design/screens.ts`), the absent Sortie. By CONCEPTION-3: `design_documents`, `renderRemarks`.
- Created by SOURCE-4: the document reader (GitHub fetcher, Local fetcher through `artifact.read`: `change`, `file`), keyed with `@tanstack/query-core`; Runner offline → title and state.
- Created by UI-6: `Capture`; by UI-2: `Tabs`, `Chip`, `ListRow`, `Card`.

## To do

- **Absent Maquettes** (`apps/server/src/designs/approvals.ts`): a gate whose only document Entrée is absent passes at once, without a Décision, its Sortie absent too.
- **Reading** (`apps/web/src/views/revue-maquettes.ts`), through SOURCE-4's reader at the document's `verdictSha`, keyed by Projet + SHA + path: `design/screens.json` (parsed with `zScreensIndex`), the change's files, then the PNGs of the selected screen, turned into object URLs revoked on leave. GitHub: the contents API with `Accept: application/vnd.github.raw` and the user token; Local: `artifact.read` of a `file`, its answer carrying the bytes (add `encoding: 'base64'` to the answer of `packages/contracts/src/runner/artifact.ts` if SOURCE-4's carries text only). Only the screens the change adds or changes are shown, in `screens.json`'s order.
- `/conceptions/:id/maquettes/:stepId`: Composant `PageRevueMaquettes` (`packages/contracts/src/composants/page-revue-maquettes.ts`, skin implementation, in `COMPOSANTS`) with `examples`: header « Maquettes · <title> », « <Projet> · N écrans · PR #n » (« changement #n » for Local), back to the Conception; one tab per screen and state of the change; the card of the selected one (its stories, « état nominal » or the state's title, chips « 390 » / « 1280 » choosing the capture shown, both side by side at 1280 px); « Écrans » listing them with their stories and remark count; « Remarques sur cet écran » (`Message`s and a `TextField` « Ce qui doit changer sur cet écran », kept in the tab's memory). A Local Projet whose Runner is « hors ligne »: the title and state only, « Le Runner est hors ligne : les captures se lisent quand il revient. », « Approuver » disabled with that reason.
- « Demander des changements » (shown only when the gate has a Retour): one comment on the change with `ticket-comments.ts`, `renderRemarks` with the screen's id as each remark's passage (`**R<n>** · Sur <screen id>`), then CONCEPTION-4's `request-changes` with its id.
- « Approuver les maquettes »: Action sensible `document.approve`; consequences « Crewdeck va : merger la PR #n des maquettes dans <integration branch> » (« le changement #n des maquettes dans <integration branch>, dans ton dossier » for Local) « ; démarrer l'Étape <next> avec le Rôle <Rôle> (<Moteur>). », the next Étapes from the pinned definition; calls CONCEPTION-4's `approve` with the gate's StepRun and the SHA read.
- The `document-review` Décision of a gate on Maquettes opens this page; CONCEPTION-2's « Relire les maquettes » leads here.
- Copy under `t('revueMaquettes.*')`.
- Tests and scenarios: `apps/server/src/testing/scenarios/revue-maquettes.ts` (the fake GitHub holding a `screens.json` of three screens and their PNGs at a SHA; a Local variant with the fake Runner answering `artifact.read`), `apps/web/e2e/revue-maquettes.spec.ts`.

## Decisions already made

- Mockup: `revue-maquettes`, `revue-maquettes-confirmation` (pages `design/screens/crewdeck/revue-maquettes.html`, `…/revue-maquettes-confirmation.html`; captures `design/screens/crewdeck/revue-maquettes-390.png`, `…-1280.png` and the same for the state). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- Captures are fetched with the user token on GitHub (raw URLs of a private repository need it) or through the relay on Local, never proxied nor stored by the server.
- Remarks are per screen in the page, one comment on the change when sent, in CONCEPTION-3's remarks format, which the Maquettes Skill settles.
- The page is chosen by the gate's Entrée type (Maquettes), whatever the gate's name.

## Acceptance criteria

- [ ] On a GitHub Projet the page lists the change's three screens as tabs and shows the 390 and 1280 px captures read from the (fake) GitHub at `verdictSha`; the server reads none of them.
- [ ] On a Local Projet the same captures come through the relay from the fake Runner; with the Runner « hors ligne » only the title and state show and the approval is disabled.
- [ ] A remark added on « Notifications » counts « 1 remarque » in « Écrans »; « Demander des changements » writes one comment grouping the remarks by screen and the Maquettes Étape reruns.
- [ ] « Approuver les maquettes » opens the product's confirmation; confirming merges the change at that SHA and the engine starts the next Étape.
- [ ] A head moved since the page loaded refuses the approval with `designs.head-moved` and the page asks to reload.
- [ ] An absent Maquettes passes the gate at once, with no Décision.
- [ ] Playwright at 390 and 1280 px on both states, axe without violations.

## Verification

- `pnpm exec nx test web -- src/views/revue-maquettes.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/page-revue-maquettes.spec.ts`
- `pnpm exec nx test server -- src/designs/approvals.spec.ts`
- `pnpm exec nx e2e web -- revue-maquettes.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`
- `scripts/captures.sh revue-maquettes revue-maquettes-confirmation`.

## For prod

Nothing.

## Out of scope

- The visual review of a Ticket's captures: BOUCLE-6.
- Comparing the delivered screens with the mockups: US-85 (Lancement).
- The approval's merge and the Retour: CONCEPTION-4, PROCESS-6.

## Dependencies

- CONCEPTION-5.
