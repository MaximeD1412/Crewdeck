---
id: PROCESS-9
title: "Arrows, Retours and Outils on the canvas: typed arrows refused with a Toast, a Retour's maximum, « Attacher un Outil »"
epic: PROCESS
type: feature
priority: P0
size: M
milestone: M4 Boucle
blocked_by: [PROCESS-8, RUNNER-16]
adr: [0011, 0013]
risques: []
stories: [US-93, US-94, US-95, US-73]
screens: [process-fleche-refusee, process-etape, runner-serveurs-mcp]
revue_visuelle: true
video: false
---

## Context

US-94: an arrow is accepted only from a Sortie to an Entrée of the same Type d'artefact. US-95: a Retour from an Étape that judges to an earlier Étape of its Phase, with a maximum of iterations (3 by default). US-93: attaching Outils to an Étape (its Rôle, its Skill, Serveurs MCP, a Commande, the Connecteurs it reads). US-73: the Serveurs MCP declared on the Runner are attached to the Étapes whose agents may use them. ADR 0011: the canvas refuses what is never drawable (an arrow between two types, an arrow closing a cycle, a Retour from an Étape that does not judge, to another Phase or not before it), `validateDefinition` deciding in the page before each change and on the server at each save; Outils are `{ kind: 'role', roleId }`, `{ kind: 'skill', skillId }`, `{ kind: 'mcp', name }`, `{ kind: 'command', commandId }`, `{ kind: 'connector', connector: 'github' }`. ADR 0013: the server knows the Serveurs MCP' names only; « Attacher un Outil » with none declared points to the Runner's page; a name the Runner no longer declares is a point of the Projet's preparation, not a Manque.

## Current state of the code

- Created by PROCESS-8: `apps/web/src/process/edit.ts` (pure edits ending on `validateDefinition`), `apps/web/src/process/draft.ts` (the saver, its 409 and 422 handling), `apps/web/src/api/process.ts`, PageProcessEditor editable at 1280 px with its Toast, the Étape and Phase panels' fields, `apps/web/e2e/process-edit.spec.ts`.
- Created by PROCESS-7: the Étape panel's read « Retour », « Entrées et Sorties » and « Outils », `apps/web/src/process/canvas.ts`, the scenarios `process`, `process-etape`.
- Created by PROCESS-1 / PROCESS-2: `catalogue.ts` (each kind's `judges`, capabilities, default Rôle and Skill), `validateDefinition`, `findGaps` (`capability.missing`), the fixtures.
- Created by UI-8: ProcessCanvas's `connect` and `loopBack` actions, the provisional arrow and curve, the ports' `compatible` / `refused`, the arrows' `refused` state, the `menu` Emplacement, Toast. Created by UI-9: Menu, Stepper.
- Created by RUNNER-16: `mcp_servers` (names and states the Runner reports through `mcp.servers`), the event resource and web slice `mcp-server`, `PageRunner` version 2 with `mcpServers: [{ name, transport, state, toolCount }]` and its card « Serveurs MCP » whose rows' meta is « stdio · <n> outils » (the mockup's « attaché à … » left to this ticket).
- Created by PARAM-1 / PARAM-2: the Rôles (`idea`, `design`, `code`, `review`) and each one's Moteur and model in the `settings` slice. Created by PROJET-2: the Projet's repository (`fullName`), null for a Local Projet (PROJET-6).

## To do

- **Edits** in `apps/web/src/process/edit.ts`, same shape as PROCESS-8's:
  - `connect(definition, from, to)`, `disconnect(definition, from, to)`; every refusal `validateDefinition`'s (`arrow.type-mismatch`, `arrow.cycle`, `input.many-arrows`, `arrow.direction`);
  - `addLoopBack(definition, from, to)` (`max` 3), `setLoopBackMax(definition, from, max)` (1 to 10), `removeLoopBack(definition, from)`; refusals `loop-back.not-judging`, `loop-back.other-phase`, `loop-back.not-before`, `loop-back.many`;
  - `attachTool(definition, stepId, tool)`, `detachTool(definition, stepId, tool)`: one Rôle and one Skill per Étape (attaching another replaces it), a Serveur MCP once by name, `connector: 'github'` only for a Projet with a repository; a Commande adds `commands: [{ id: 'cmd-<n>' }]` and its `{ kind: 'command', commandId }`; what each family takes: agent Étapes a Rôle, a Skill, Serveurs MCP and a Connecteur; `checks` a Connecteur or Commandes; `command` Étapes Commandes; gates and `merge` nothing;
  - `candidates(definition, input)` and `loopBackTargets(definition, stepId)`: the Sorties and Étapes each of them accepts, by running the edit without applying it.
- **The canvas**: `connect` and `loopBack` relayed to the edits; an accepted one is saved as in PROCESS-8; a refused one draws the attempted arrow `refused` and shows a halt Toast (`block` icon) `process.arrow.refused` « Refusée : {reason} » (« Refusée : une Sortie Changement de code ne va que vers une Entrée Changement de code, et « Revue visuelle » attend ici des Maquettes. »), both cleared after 6 s or at the next edit; a Retour drawn shows an accent Toast « Retour de « Review » vers « Code », 3 fois au plus. ».
- **The Étape panel** (`PageProcessEditor` data and actions, with examples):
  - « Entrées et Sorties »: each fed Entrée gets the IconButton « Retirer la flèche » → `disconnect { from, to }`; an unfed Entrée the Select « Alimentée par » of its `candidates` (« Verdict · Checks ») → `connect`; each Sortie lists its arrows with their « Retirer la flèche »;
  - « Retour », for an Étape that judges: without one, the Select « Poser un Retour vers » of its `loopBackTargets` → `addLoopBack { from, to }`; with one, its sentence (« Vers « Code », tant que la Review demande des changements. Au-delà, le Ticket s'arrête sur une Décision. », « la Conception » for an `idea.retained` Phase, « l'Idée » for `idea.noted`, « l'Artefact » otherwise), the Stepper « Au plus » `fois` 1 to 10 → `setLoopBackMax { from, max }`, and « Retirer le Retour » (ghost, `trash`) → `removeLoopBack { from }`;
  - « Outils »: each row's IconButton `x` « Détacher le Rôle Review », « Détacher la Skill review », « Détacher le Serveur MCP stitch » … → `detachTool { stepId, tool }`; a Serveur MCP the Runner does not declare says « non déclaré sur {machine} »; « Attacher un Outil » (secondary, `plus`) → `openAttach { stepId }`, absent on a gate and on the Merge.
- **« Attacher un Outil »** (`apps/web/src/process/attach-menu.ts`, pure): the Menu « Attacher à « {Étape} » » in the canvas's `menu` Emplacement, with only the groups the Étape takes: « Rôle (un seul) » (each Rôle, detail « Moteur · modèle » from the Paramètres, the attached one `selected`), « Skill (une seule) » (the official Skills of the catalogue, detail « officielle »), « Serveur MCP, déclaré sur {machine} » (each declared name, detail « donne ses outils aux agents de l'Étape », an attached one disabled « déjà attaché », then « Déclarer un Serveur MCP », `plus`, « sur la page Runner et Comptes IA », which goes to `/runner`), « Commande, sur {machine} » (« Nouvelle Commande », `terminal`, « une commande de ton choix », shown from PROCESS-12), « Connecteur » (« GitHub », `plug`, the repository's `fullName`, for a Projet with one); `choose` → `attachTool`, then the Menu closes; `close` closes it.
- **« attaché à » on the Runner page** (`runner-serveurs-mcp`'s meta, which RUNNER-16 leaves out): `apps/web/src/process/mcp-attachments.ts` (pure) computes, from every Projet's active version and draft in the `process` slice, the Étapes attaching each server by name, grouped by Étape name with their Projets; `PageRunner`'s `mcpServers[]` gains `attachedTo: string | null` (« attaché à « Maquettes » · Site mairie, Personal OS », « attaché à aucune Étape »), added here to its contract, its examples and `packages/skin-passerelle/src/page-runner.ts`, which shows it after the transport and tool count; `runnerView` (`apps/web/src/views/runner.ts`) fills it. A name attached only in a draft counts (« Maquettes » listed once).
- Handlers in `apps/web/src/actions/process-editor.ts`; `t()` keys `process.arrow.*`, `process.loopBack.*`, `process.tools.*`, `runner.mcp.attachedTo`, `runner.mcp.attachedToNone`.
- Scenario `process-fleche-refusee` in `apps/server/src/testing/scenarios/process.ts` and its `PREPARE` in `apps/web/e2e/captures.spec.ts` (the drag from « Code »'s Sortie onto « Revue visuelle »'s Maquettes); `process-etape`'s `PREPARE` opens « Attacher un Outil » with two Serveurs MCP declared on the fake Runner (`stitch`, `figma`); Playwright `apps/web/e2e/process-arrows.spec.ts`.

## Decisions already made

- Mockup: `process-fleche-refusee`, `process-etape`, `runner-serveurs-mcp` (its « attaché à » line only) (pages `design/screens/gestion-du-process/process-fleche-refusee.html`, `…/process-etape.html`, `design/screens/crewdeck/runner-serveurs-mcp.html`; captures `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The Étape panel's « Phase » select and « Retirer » are PROCESS-8's.
- Whether an arrow or a Retour is allowed is `validateDefinition`'s answer only (PROCESS-2), the Toast saying its label: this ticket writes no rule of its own.
- Every gesture of the canvas has a keyboard path in the panel (« Alimentée par », « Poser un Retour vers »), which the e2e uses besides the drags.
- A Commande attached here is the definition's entry and its Outil only (`attachTool`, tested pure): its text, place and health address are sealed by PROCESS-12's form. Because `PUT …/draft` refuses a Commande without its sealed part (PROCESS-3's `zProcessDraftInput`), the Menu's « Commande » group is built here but shown only once PROCESS-12's sealing is there (`attachMenuOf(…, { commands: false })` until PROCESS-12 sets it); its `capability.missing` is met by the Outil (ADR 0011), whatever its text.
- The Runner page's « attaché à » is computed in the page from the store: the server's `mcp_servers` rows know nothing of the Process, and nothing new is stored.
- The Serveurs MCP offered are the names the Runner declares (RUNNER-16): the page never asks for their configuration, which stays on the machine (ADR 0013). A Serveur MCP gives no capability the core checks.
- The Skills offered are the official ones of the catalogue: the Pilote's own Skills are later (US-85).
- The Merge takes no Outil: it merges at the code's Source (ADR 0012). A gate takes none (DESIGN.md: no Outils).

## Acceptance criteria

- [ ] Dragging « Code »'s Sortie Changement de code onto « Revue visuelle »'s Entrée Maquettes draws it refused, shows « Refusée : … » and saves nothing; onto an unfed Entrée Changement de code adds the arrow and saves the draft.
- [ ] An arrow that would close a cycle is refused with its label; connecting an Entrée already fed is refused; « Retirer la flèche » on the Review → Merge arrow removes it and the Manques show `merge.no-review` and the Merge's unfed Entrée.
- [ ] « Alimentée par » lists only the Sorties of the Entrée's type that the rules accept, and choosing one adds the arrow.
- [ ] A Retour dropped from the Review on « Code » is added with « 3 fois au plus »; from an Étape that does not judge, or to another Phase, it is refused; the Stepper stops at 1 and 10 and saves each change; « Retirer le Retour » removes it.
- [ ] « Attacher un Outil » on the Review lists its Rôle (selected), its Skill, the two declared Serveurs MCP and GitHub; attaching « stitch » adds its chip; attaching another Rôle replaces the first; with no Serveur MCP declared, only « Déclarer un Serveur MCP » is in its group and leads to `/runner`.
- [ ] Detaching the Rôle of an agent Étape makes its `capability.missing` Manque appear; `attachTool` of a Commande to « Tests de bout en bout » clears it (`edit.spec.ts`).
- [ ] On `/runner`, « stitch » attached to « Maquettes » in two Projets shows « attaché à « Maquettes » · Site mairie, Personal OS »; « figma » attached nowhere « attaché à aucune Étape »; attaching it in a draft updates the card without reload.
- [ ] On a gate and on the Merge, « Attacher un Outil » is absent; axe without violations at 1280 px on `process-fleche-refusee` and `process-etape`.

## Verification

- `pnpm exec nx test web -- src/process/edit.spec.ts src/process/attach-menu.spec.ts src/process/mcp-attachments.spec.ts src/views/process-editor.spec.ts src/views/runner.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/page-process-editor.spec.ts src/page-runner.spec.ts`
- `pnpm exec nx e2e web -- process-arrows.spec.ts process-edit.spec.ts runner.spec.ts`
- `scripts/captures.sh process-fleche-refusee process-etape` for the PR
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

Nothing.

## Out of scope

- A Commande's text, place, health address and their sealing: PROCESS-12. Declaring a Serveur MCP: RUNNER-16; mounting it in a Session: RUNNER-17.
- What a Retour does at run time and its Décision `loop-back.exhausted`: PROCESS-6. Activation: PROCESS-10.

## Dependencies

- PROCESS-8
- RUNNER-16
