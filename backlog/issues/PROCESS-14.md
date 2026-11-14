---
id: PROCESS-14
title: "Modèles de process: save a Projet's active version, list, rename and delete them in the Paramètres, start a Projet from one"
epic: PROCESS
type: feature
priority: P1
size: M
milestone: M4 Boucle
blocked_by: [PROCESS-10, PARAM-1, PROJET-6]
adr: [0011, 0003]
risques: []
stories: [US-97, US-111]
screens: [process-enregistrer-modele, parametres]
revue_visuelle: true
video: false
---

## Context

US-97: each new Projet starts from a Modèle de process (« Process Crewdeck » by default), and the Pilote saves a Projet's Process as a Modèle of their own for their next Projets: its active version (Phases, Étapes, arrows, Retours, Outils, the Serveurs MCP by their name and the Commandes as their text), never its Sources. US-111: the Modèles are listed in the account's Paramètres (each one's name, the Projet it was saved from, its date), renamed or deleted, saving again under a Modèle's name replacing it. ADR 0011: `process_templates` (`pilotId`, `name` unique per Pilote, `fromProjectId`, `createdAt`), `POST /api/process-templates` with `replace: true` to overwrite one of the same name, `PATCH`, `DELETE`; « Process Crewdeck » is release data, not a row; creating a Projet copies the chosen Modèle into version 1, its Commandes re-sealed for the Projet by the browser; the sealed part's additional data is `process:<projectId>` or `template:<templateId>`. ADR 0003 (as ADR 0011 amends it): a Modèle's name is configuration the server reads; a Commande's text is not.

## Current state of the code

- Created by PROCESS-1: `packages/contracts/src/process/templates/process-crewdeck.ts`, `ProcessDefinition`. Created by PROCESS-3: `process_versions` (`definition`, `sealed`), `ProcessService.createInitialVersion(tx, projectId, from: { template: 'process-crewdeck' }, sources)` called at the Projet's creation (version 1, or only a draft when the copy has Manques), `zProjectProcess` (`active` nullable), the `process` slice.
- Created by PROCESS-7 / PROCESS-10: `PageProcessEditor` (its header's actions at 1280 px, its Toast), `apps/web/src/api/process.ts`, the scenarios of `apps/server/src/testing/scenarios/process.ts`.
- Created by PARAM-1: `/parametres`, `PageParametres` with `SETTINGS_SECTIONS` (`roles`, `notifications`, `schedules`, `optional-steps`, `projects`, `account`, `modders`; PARAM-3 removes `optional-steps`), `apps/web/src/views/parametres.ts`, the scenario `parametres`, `apps/web/e2e/parametres.spec.ts`.
- Created by PROJET-6: the Projet's creation from a folder or GitHub with its Select « Modèle de process » offering « Process Crewdeck » only (`zProcessTemplateId`, `templateId` in `zFollowProjects` and `zCreateLocalProject`, the latter with a page-drawn `id`, 422 `project.id-taken`). Created by PROJET-2: `POST` creating a Projet from a repository, the `project` slice.
- `apps/web/src/keys/vault.ts`: `sealItem(plaintext, aad)`, `openItem(item, aad)`, `vaultState`. `apps/server/src/ids.ts` (`newId`, uuid v7). Created by UI-4: Dialog, TextField; UI-2: Card, ListRow, Button, Empty.
- No `process_templates` table, no `process-template` resource.

## To do

- **Model** `ProcessTemplate` (`process_templates`): `id` (uuid, given by the page), `pilotId`, `name` (1 to 80 characters, trimmed), `nameKey` (its lower case, unique with `pilotId`), `fromProjectId` (nullable, `onDelete: SetNull`), `fromVersionNumber`, `definition` (jsonb, a `ProcessDefinition`), `sealed` (jsonb, nullable), `createdAt`, `updatedAt`. Migration.
- **Contracts** `packages/contracts/src/api/process-templates.ts`: `zProcessTemplate` `{ id, name, fromProjectId, fromVersionNumber, sealed, commandCount, createdAt, updatedAt }`; `zSaveProcessTemplateInput` `{ id: zId, name, projectId, versionNumber, sealed: zSealedItem | null, replace: boolean }`; `zRenameProcessTemplateInput` `{ name }`. Event resource `process-template` (`process-template.upserted` with `zProcessTemplate`, `process-template.deleted` with `{ id }`), registered in `events/index.ts`.
- **Server** `apps/server/src/process/templates/`:
  - `POST /api/process-templates`: copies the Projet's active version's `definition` and takes the body's `sealed`; refuses another version than the active one (409 `process.version-stale` « La version active a changé : enregistre à nouveau. »), a name already taken without `replace` or with `replace` but another `id` (409 `process-template.name-taken` « Un Modèle de process porte déjà ce nom. »), the name « Process Crewdeck » in any case (422 `process-template.name-reserved` « Ce nom est celui du Modèle de Crewdeck. »), a `sealed` missing while the version has one or present while it has none (422 `process-template.sealed-mismatch`); with `replace` and the same name and `id`, overwrites `definition`, `sealed`, `fromProjectId`, `fromVersionNumber`, `updatedAt`. Returns the resource (201 created, 200 replaced).
  - `PATCH /api/process-templates/:id` `{ name }` → the resource, the same name rules; `DELETE /api/process-templates/:id` → 204. Each writes its event in the same transaction.
  - `StateContributor` key `processTemplates`.
  - The Projet's creation: `zProcessTemplateId` (PROJET-6's, « Process Crewdeck » only) becomes `'process-crewdeck' | zId`; `zCreateLocalProject` (whose `id` the page already draws, PROJET-6) and each item of `zFollowProjects` (PROJET-2's GitHub path, which gains a page-drawn `id`, uuid v7, required with an own Modèle, 422 `project.id-taken` when used) gain `templateSealed: zSealedItem | null`; `createInitialVersion`'s `from` gains `{ template: zId, sealed }`: an own Modèle's `definition` with that `sealed`, as version 1, or as the draft when `findGaps` finds a Manque with the new Projet's Sources (PROCESS-3's rule); a Modèle gone: 404 `process-template.not-found` « Ce Modèle de process n'existe plus. »; `sealed` mismatching its Modèle: 422 `process-template.sealed-mismatch`.
  - French messages in `apps/server/src/errors/messages.ts`; route baseline in `process-templates.controller.spec.ts`; `test/integration/process-templates.spec.ts` (save, replace, rename, delete with their events; a Projet deleted leaves its Modèles with `fromProjectId` null; a Projet created from a Modèle gets its definition as v1; another Pilote's Modèle is a 404).
- **Re-sealing** `apps/web/src/process/seal.ts`: `resealProcess(vault, sealed, fromAad, toAad)`, opening with one additional data (`process:<projectId>`, `template:<templateId>`) and sealing with the other; `null` stays `null`.
- **Web**:
  - slice `process-template` (collection, `snapshotKey: 'processTemplates'`); command client `apps/web/src/api/process-templates.ts`.
  - `PageProcessEditor` at 1280 px: the header's ghost « Enregistrer comme Modèle de process » (`copy`) → `openSaveTemplate {}`, then its Dialog (data `saveTemplate: { name, error, replaceId: zId | null, versionNumber, draft: boolean, locked: boolean } | null`): the TextField « Nom du Modèle de process » (« Process {Projet} » by default), « Il copie la v{n} active : ses Phases, leurs Étapes, leurs Outils et leurs Retours. Tes prochains Projets pourront partir de lui ; {Projet} garde son Process. », with a draft « Ton brouillon n'y est pas : active-le pour l'y mettre. », « Annuler » (`closeSaveTemplate {}`) and « Enregistrer le Modèle de process » (primary, `check`, `saveTemplate { name }`); a name of one of the Pilote's Modèles shows « Un Modèle de process porte déjà ce nom. » under the field and turns the button into « Remplacer « {name} » » (`replace: true` with that Modèle's `id`); a version with Commandes and the vault locked disables it with « Approuve cet Appareil pour copier ses Commandes. »; a Projet without an active version disables the header's button with « Active d'abord une première version. »; success closes it with a go Toast « Modèle de process « {name} » enregistré. ».
  - Composant `ProcessTemplateList` (`packages/contracts/src/composants/process-template-list.ts`, `packages/skin-passerelle/src/process-template-list.ts`, category `partie`), composed of Card, ListRow, Button, Empty, TextField and Dialog: data `{ templates: { id, name, meta }[], renaming: { id, name, error: string | null } | null, removing: { id, name } | null }`; the Card « Modèles de process » with its count, one ListRow per Modèle (`layers`, its name, its meta « depuis Site mairie · 12 nov. », « depuis un Projet supprimé · 12 nov. »), trailing « Renommer » (ghost, sm) and « Supprimer » (ghost, sm, `trash`); none: Empty `layers` « Aucun Modèle de process », « Enregistre le Process d'un Projet depuis sa Gestion du process : tes prochains Projets pourront partir de lui. »; the Dialog « Renommer le Modèle de process » (TextField « Nom du Modèle de process », « Annuler », « Renommer »), the Dialog « Supprimer le Modèle de process « {name} » ? » (« Les Projets partis de lui gardent leur Process. », « Annuler », « Supprimer », danger); actions `rename { id }`, `submitRename { id, name }`, `remove { id }`, `confirmRemove { id }`, `cancel {}`.
  - `PageParametres`: `SETTINGS_SECTIONS` gains `process-templates` after `projects` (anchor `modeles`, nav `settings.nav.processTemplates` « Modèles de process »); `views/parametres.ts` places `ProcessTemplateList` in it, always (its Empty included), newest `updatedAt` first.
  - The Projet's creation (PROJET-6's Select « Modèle de process »): « Process Crewdeck », then the Pilote's Modèles by name; choosing one with Commandes generates the Projet's `id` in the page and re-seals from `template:<templateId>` to `process:<projectId>` before the request; the vault locked disables those options with « Approuve cet Appareil pour copier ses Commandes. ».
- `t()` keys `process.template.*`, `settings.processTemplates.*`.
- Scenarios `process-enregistrer-modele` (the `process` Projet, the Dialog opened by `PREPARE` in `apps/web/e2e/captures.spec.ts`) and the `parametres` scenario gaining two Modèles; Playwright `apps/web/e2e/process-templates.spec.ts` and the Modèles card in `parametres.spec.ts`.

## Decisions already made

- Mockup: `process-enregistrer-modele` (page `design/screens/gestion-du-process/process-enregistrer-modele.html`; capture `…-1280.png`) and `parametres` (page `design/screens/crewdeck/parametres.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The account's Paramètres have no mockup of the Modèles: their card is the Card, ListRow, Button and Empty of the page's other cards (« Planifications »), placed after « Par Projet ».
- A Modèle copies the active version, never the draft (US-97): the draft has not passed its Manques yet.
- The ids bound by the additional data must be known before sealing: the page generates the Modèle's `id`, and the Projet's when it starts from a Modèle with Commandes (uuid v7, as `apps/server/src/ids.ts`); the server checks it is unused. A version is never re-sealed after it is written.
- The names are unique per Pilote regardless of case and outer spaces; « Process Crewdeck » stays the release's own name. Replacing is a choice of the Pilote shown in the dialog, never automatic.
- Renaming and deleting a Modèle are not Actions sensibles (PRD's list): the page's Dialog confirms the deletion; a Projet started from a Modèle keeps its Process (a copy, US-109 being later).
- The list shows only the Pilote's Modèles: « Process Crewdeck » is not one of them and cannot be renamed nor deleted.
- A Local Projet's name is sealed: the server stores `fromProjectId`, the page writes « depuis {name} » from the `project` slice.

## Acceptance criteria

- [ ] « Enregistrer comme Modèle de process » with « Process Site mairie » saves the active v3 (its definition, its Commandes re-sealed under `template:<id>`), shows « Modèle de process « Process Site mairie » enregistré. », and the Modèle appears in `/parametres` « Modèles de process » with « depuis Site mairie » and its date, in another tab too.
- [ ] Saving under an existing name shows the error and « Remplacer « … » »; replacing overwrites it (one row, its new date); « Process Crewdeck » is refused; a version activated meanwhile gives « La version active a changé… ».
- [ ] Renaming to a taken name shows « Un Modèle de process porte déjà ce nom. »; deleting asks the Dialog and removes it; a Projet started from it keeps its Process.
- [ ] A new Projet started from a Modèle with a Commande gets that Modèle's definition as v1 and a sealed part the Runner opens with `process:<projectId>` (an integration test opens it with the test vault key), never `template:`.
- [ ] The route baseline: 400, 401, 404 for another Pilote's Modèle or Projet, 409 and 422 as above; each change writes its event in the same transaction.
- [ ] Without any Modèle, the card shows its Empty; axe without violations on `process-enregistrer-modele` at 1280 px and `parametres` at 390 and 1280 px.

## Verification

- `pnpm exec nx test server -- src/process/templates/process-templates.controller.spec.ts`
- `pnpm exec nx test-integration server -- process-templates`
- `pnpm exec nx test web -- src/process/seal.spec.ts src/views/parametres.spec.ts src/views/process-editor.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/process-template-list.spec.ts src/page-parametres.spec.ts`
- `pnpm exec nx e2e web -- process-templates.spec.ts parametres.spec.ts`
- `scripts/captures.sh process-enregistrer-modele parametres` for the PR
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

A migration (`process_templates`), run by the deploy.

## Out of scope

- Offering a Modèle's change to the Projets started from it: US-109, later. Export and import of a Modèle as a file: no story.
- The Projet's creation forms themselves: PROJET-2, PROJET-6. The Commande's text and its form: PROCESS-12.

## Dependencies

- PROCESS-10
- PARAM-1
- PROJET-6
