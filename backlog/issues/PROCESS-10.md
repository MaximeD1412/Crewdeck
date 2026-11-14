---
id: PROCESS-10
title: "Activating a draft: the diff since the active version, the Action sensible process.activate, a draft with a Manque refused"
epic: PROCESS
type: feature
priority: P0
size: M
milestone: M4 Boucle
blocked_by: [PROCESS-7, PROCESS-4]
adr: [0011, 0007]
risques: [AGT-9]
stories: [US-96, US-26]
screens: [process-activation]
revue_visuelle: true
video: false
---

## Context

US-96: the Pilote activates a changed Process as an Action sensible, after seeing what changed since the active version; the new version applies to the work that starts after it, what is in progress finishing on the version it started with. US-26: an Action sensible is confirmed in the product's own dialog, whatever the Skin. ADR 0011: `POST /api/projects/:id/process/activate` is the Action sensible `process.activate`; its dialog lists the diff (`packages/contracts/src/process/diff.ts`, a pure function) and the work that stays on its version; the server refuses a draft with a Manque (422 `process.has-gaps`), then writes version n+1 and deletes the draft in one transaction with its event (ADR 0007). Risk AGT-9: « Un Process avec un Manque ne s'active pas, vérifié par la même fonction dans la page et le serveur ».

## Current state of the code

- `packages/contracts/src/api/sensitive-actions.ts`: `SENSITIVE_ACTION_IDS` (`merge`, `loop.start`, `schedule.create`, `schedule.resume`, `document.approve`, `inventory.approve`), `withSeq`. `apps/server/src/sensitive-actions/` (`@SensitiveAction(id)`, `SensitiveActionsService.assertFresh`, 409 `sensitive-action.stale`), `apps/server/src/errors/messages.ts`, `Transactions.run` + `EventsWriter.write`. Web: `apps/web/src/actions/dispatcher.ts` (`SensitiveActionHandler { confirmation, run(payload, { seq }) }`), `apps/web/src/dialogs/confirm.ts` (`crewdeck-confirm`, `ConfirmConsequences { lead, items: { strong, text }[], note }`).
- Created by PROCESS-3: `apps/server/src/process/` (`process_versions` unique per `(projectId, number)`, `process_drafts` with `revision` and `baseVersion` (0 for a Projet without an active version), `zProjectProcess { id, active | null, draft | null }` built by `process.view.ts` `toProjectProcess`, `PUT …/draft`, `process.upserted`), errors `process.draft-stale`, `process.invalid`, `apps/web/src/api/process.ts`. Created by SOURCE-1: the view's `sources`, `processSourcesOf`.
- Created by PROCESS-4: `apps/server/src/process/engine/` (`phase_runs` pinned to the version active when they start, `Engine.admit`). Created by PROCESS-2: `validateDefinition`, `findGaps(definition, sources)`; SOURCE-1 the Sources given to it.
- Created by PROCESS-7, PROCESS-8, PROCESS-9: `/projets/:id/process`, `PageProcessEditor` and its Toast, the header's count (« brouillon · 5 Manques »), the footer « Brouillon en cours sur la v3. », the scenarios in `apps/server/src/testing/scenarios/process.ts`.
- No `diff.ts`, no activation route, no `process.activate`.

## To do

- **Contracts**:
  - `packages/contracts/src/process/diff.ts`: `diffDefinitions(from, to): ProcessChange[]`, pure; kinds `phase.added`, `phase.removed`, `phase.renamed`, `phase.for-each-changed`, `step.added`, `step.removed`, `step.moved` (to another Phase), `arrow.added`, `arrow.removed`, `loop-back.added`, `loop-back.removed`, `loop-back.max-changed`, `tool.attached`, `tool.detached`, and one `layout.changed` for every cell move inside a Phase or of a Phase together; each change carries the ids and the names it needs from both definitions (an arrow its two Étapes' names, a Retour its old and new `max`). Ids match across versions (ADR 0011), so a renamed Phase is one change, not a removal and an addition. Its spec on PROCESS-2's fixtures.
  - `SENSITIVE_ACTION_IDS` gains `process.activate`; `zActivateProcessInput = withSeq({ revision: int })` in `packages/contracts/src/api/process.ts`.
  - `zProjectProcess` gains `running: { phaseRunId, versionNumber, itemType, itemId, ticketNumber: int | null }[]`, the Projet's PhaseRuns `running` or `waiting` (from `phase_runs`), filled by `toProjectProcess`; `process.upserted` is written again when a PhaseRun starts or ends, so that the list stays current.
- **Server** (`apps/server/src/process/`):
  - `POST /api/projects/:id/process/activate`, `@SensitiveAction('process.activate')`: in one transaction, read the draft (none: 409 `process.no-draft` « Il n'y a pas de brouillon à activer. »), compare its `revision` (another: 409 `process.draft-stale`), `validateDefinition` (422 `process.invalid`), `findGaps(draft, sources)` (any: 422 `process.has-gaps` « Ce brouillon a des Manques : règle-les avant de l'activer. »), `diffDefinitions(active, draft)` empty (422 `process.no-change` « Le brouillon ne change rien à la v{n}. »; never for a Projet without an active version); then write `process_versions` number n+1 (1 without an active version) (`definition`, `sealed` copied from the draft, `activatedAt`, `activatedBy`), delete the draft, write the `process` event; return the process view. An unknown or another Pilote's Projet: 404.
  - French messages in `apps/server/src/errors/messages.ts`.
  - Route baseline in `process-activation.controller.spec.ts` (400, 401, 404 for another Pilote, 409 stale `seq`, each error above); `test/integration/process-activation.spec.ts`: version n+1 and its event written together, the draft gone; a PhaseRun running on v3 keeps `processVersionId` of v3, and an item admitted after (`Engine.admit`) is pinned to v4; two concurrent activations of the same revision give one version and one 409.
- **Web**:
  - `apps/web/src/process/diff-labels.ts`: each `ProcessChange` in French through `t('process.diff.<kind>')`: « Étape « Inventaire » ajoutée », « flèche « Review » → « Merge » retirée », « Serveur MCP « stitch » attaché à « Maquettes » », « Retour de « Review » vers « Code » : 5 fois au plus, au lieu de 3 », « Phase « Livraison » ajoutée », « disposition du canevas modifiée »…
  - `views/process-editor.ts`: the header's count « brouillon · 3 changements » (with « · 5 Manques » when there are); without an active version no diff: « brouillon · première version »; the footer's `changes` « 3 changements depuis la v3 : {the labels, joined by « ; »}. » and its `versions` line gaining the running work (« v3 active depuis le 4 nov. · 2 Tickets en cours finissent sur la v2 », « · aucun travail en cours »); the header's primary « Activer la v{n+1} » (`check`) → `activate { revision }`, declared `sensitive('process.activate', …)` in `PageProcessEditor`; « Activer » disabled without a draft, disabled with `process.activate.hasGaps` « Règle les Manques pour activer. » when `findGaps` finds one, and with « Aucun changement » when the diff is empty; during the Resynchronisation disabled with its reason (CORE-7).
  - The confirmation (`apps/web/src/actions/process-editor.ts`): title « Activer la v{n+1} du Process de {Projet} ? », action « Activer la v{n+1} », icon `check`; lead « {k} changements depuis la v{n} : », one item per change; without an active version, the lead « La première version du Process de {Projet} : son travail pourra démarrer. » and no list; note « Le travail qui démarre ensuite suit la v{n+1}. Ce qui est en cours finit sur la version où il a démarré : {list} » (« les Tickets #53 et #57 sur la v3, la Conception « Actualités » sur la v2 »: a Ticket by its number, an Idée or a Conception by its title when the store holds it opened, else counted « 1 Conception »), or « Aucun travail en cours. ».
  - `run` → `POST /api/projects/:id/process/activate` with the `seq` of the dialog (`apps/web/src/api/process.ts`); on success a go Toast « Version {n+1} active. » (`check`); an error's `message` in a halt Toast.
- **Pilotage**: in `docs/pilotage/risques.json`, AGT-9's solution « Un Process avec un Manque ne s'active pas, vérifié par la même fonction dans la page et le serveur » ticked, `statutDepuis` dated.
- Scenario `process-activation` (a draft with three changes on v3: two Serveurs MCP attached to « Maquettes », the Review's Retour from 3 to 5; Tickets #53 and #57 running on v3, a Conception on v2) and its `PREPARE` in `apps/web/e2e/captures.spec.ts` (« Activer la v4 » pressed, the confirmation open, `SCREEN_ONLY`); Playwright `apps/web/e2e/process-activation.spec.ts`.

## Decisions already made

- Mockup: `process-activation` (page `design/screens/gestion-du-process/process-activation.html`; capture `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The page and the server run the same `findGaps` and `validateDefinition` (AGT-9): the button is disabled by the page's answer, the route refuses by its own. The server has no use of the diff besides refusing an empty one; the dialog's list is the page's.
- Activation never touches a running PhaseRun (ADR 0011): the version is pinned at a PhaseRun's start by PROCESS-4; this ticket only writes the next version.
- The cell moves are one change, « disposition du canevas modifiée »: listing each card moved would bury the changes that matter.
- A Commande's text lives in the sealed part, which the server cannot diff: PROCESS-12 adds its changes to the page's list (it opens both sealed parts).
- The draft's `revision` in the body binds the confirmation to what the Pilote saw: an edit of another tab between the dialog and the click makes it 409 `process.draft-stale`, as the `seq` does for the rest of the state.
- Once activated, the draft is deleted: the next edit starts a new draft from the new version (PROCESS-3).
- A Projet whose creation left only a draft (PROCESS-3: its copy of the Modèle had Manques) activates it as v1 by the same route: there is no diff to show, and nothing of its work started before.

## Acceptance criteria

- [ ] With a draft of three changes and no Manque, « Activer la v4 » opens `crewdeck-confirm` « Activer la v4 du Process de Site mairie ? » listing the three changes and the work in progress by version; confirming writes v4, deletes the draft, and the page shows « v4 active », « Aucun changement depuis la v4. » and « Version 4 active. ».
- [ ] « Annuler » writes nothing; « Activer » is disabled without a draft, with a Manque (« Règle les Manques pour activer. ») and with an empty diff.
- [ ] The route refuses a draft with a Manque (422 `process.has-gaps`), an invalid one (422 `process.invalid`), an old revision (409 `process.draft-stale`), a stale `seq` (409 `sensitive-action.stale`), no draft (409 `process.no-draft`), nothing changed (422 `process.no-change`); 404 for another Pilote's Projet.
- [ ] A Ticket running on v3 when v4 is activated finishes on v3; a Ticket admitted afterwards runs on v4.
- [ ] A Projet without an active version activates its draft, once its Manques are fixed, as v1 (« Activer la v1 », the first-version lead); its work then starts on v1.
- [ ] `diffDefinitions` gives one change per kind on the fixtures, a renamed Phase as `phase.renamed`, all cell moves as one `layout.changed`, nothing for two equal definitions.
- [ ] The version, the deleted draft and the `process` event are one transaction; another tab shows v4 without reload; axe without violations on `process-activation` at 1280 px.

## Verification

- `pnpm exec nx test contracts -- src/process/diff.spec.ts`
- `pnpm exec nx test server -- src/process/process-activation.controller.spec.ts`
- `pnpm exec nx test-integration server -- process-activation`
- `pnpm exec nx test web -- src/process/diff-labels.spec.ts src/views/process-editor.spec.ts`
- `pnpm exec nx e2e web -- process-activation.spec.ts`
- `scripts/captures.sh process-activation` for the PR
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

Nothing.

## Out of scope

- The phone's draft banner and its change count: PROCESS-11. A Commande's changes in the diff: PROCESS-12. Moving a Source, which is not a version: SOURCE-7.
- Reverting to an older version: no story.

## Dependencies

- PROCESS-7
- PROCESS-4
