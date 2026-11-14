---
id: PROCESS-1
title: "The Process as data: ProcessDefinition, Types d'artefact, the catalogue of Étapes and « Process Crewdeck »"
epic: PROCESS
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: []
adr: [0011, 0005]
risques: []
stories: [US-92, US-97]
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0011 makes the Process of each Projet a versioned document the server interprets: Phases holding Étapes with typed Entrées and Sorties, arrows between them, Retours with a maximum, Outils attached to each Étape, « pour chaque » Phases. This ticket writes that document's schema, the Types d'artefact, the catalogue of the Étapes (their kinds, ports, family, capabilities, defaults) and the Modèle de process « Process Crewdeck » as data of the release (US-97), so that everything after reads one shape: the rules of PROCESS-2 (`validateDefinition`, `findGaps`), the versions and the draft of PROCESS-3, the engine of PROCESS-4 to PROCESS-6, the canvas of PROCESS-7 to PROCESS-9 (US-92), the Modèles of PROCESS-14. It changes nothing a Pilote sees yet.

## Current state of the code

- `packages/contracts/src/contrats/define.ts`: `STEP_IDS = ['idea-analysis', 'inventory', 'prd', 'mockups', 'technical-design', 'cross-review', 'split', 'code', 'review']` (a literal list), `zStepId`, `zContrat` (its `step` is a `zStepId`), `zVerdict`; `contrats/index.ts`: `CONTRATS = []`, `CONTRAT_HISTORY = []`.
- `packages/contracts/src/registry.ts`: the schemas `contracts:generate` writes as JSON Schema and Go (`apps/runner/internal/contracts/<name>.go`); `goUnions` for the discriminated unions go-jsonschema cannot type.
- `packages/contracts/src/keys/pairing.ts`: `zBytes(min, max)` (base64url without padding). `apps/web/src/keys/vault.ts`: `SealedItem { key, ciphertext }` (`docs/security/e2e.md`, « Items under the vault key »: `key` is 12 + 32 + 16 bytes).
- `packages/contracts/src/values.ts`: no `AGENT_ROLES` on develop. Created by PARAM-1 (PR #147, open): `AGENT_ROLES = ['idea', 'design', 'code', 'review']`, `zAgentRole`, `AgentRole`.
- No `packages/contracts/src/process/` folder. RUNNER-12's ticket planned `contrats/steps.ts` (`STEPS`: each step's Rôle and Skill): the catalogue below is that table now.
- The mockup of the Process: `design/screens/gestion-du-process/process.html` (the « Process Crewdeck » Modèle on a Projet), `process-catalogue.html` (the catalogue's menu), `process-phase.html` (« Répéter »).

## To do

- `packages/contracts/src/process/artifact-types.ts`: `ARTIFACT_TYPES = ['idea', 'prd', 'mockups', 'technical-design', 'inventory', 'ticket', 'code-change', 'verdict', 'delivery'] as const`, `zArtifactType`, and `ARTIFACT_TYPE_LABELS` (« Idée », « PRD », « Maquettes », « Conception technique », « Inventaire », « Ticket », « Changement de code », « Verdict », « Livraison »).
- `packages/contracts/src/process/definition.ts` (zod, every object `strictObject`):
  - `zProcessId`: `/^[a-z0-9]+(-[a-z0-9]+)*$/`, 1 to 40 characters (`ph-dev`, `st-code`, a port's `changement`).
  - `FOR_EACH = { 'idea.noted': { type: 'idea', label: 'chaque Idée notée' }, 'idea.retained': { type: 'idea', label: 'chaque Idée retenue' }, 'ticket.ready': { type: 'ticket', label: 'chaque Ticket prêt' } }`, `zForEach`.
  - `zPhase { id, name (trimmed, 1 to 60), col, row (int 1 to 50), forEach: zForEach | null }`.
  - `zPort { id, type: zArtifactType, note? (trimmed, 1 to 40) }`.
  - `zTool`, discriminated by `kind`: `{ kind: 'role', roleId: zRoleId }` (PARAM-2's `zRoleId`: `zAgentRole` or `r-` then 8 `[a-z0-9]`, written here with the same definition in `packages/contracts/src/api/roles.ts` if PARAM-2 is not merged; whether the Rôle exists is the readiness's, PROJET-3), `{ kind: 'skill', skillId: /^[a-z0-9]+(-[a-z0-9]+)*$/ }`, `{ kind: 'mcp', name (trimmed, 1 to 60) }`, `{ kind: 'command', commandId: zProcessId }`, `{ kind: 'connector', connector: z.literal('github') }`.
  - `zStep { id, phaseId, kind: zStepKind, name (trimmed, 1 to 60), col, row, inputs: zPort[] (≤ 8), outputs: zPort[] (≤ 4), tools: zTool[] (≤ 10) }`.
  - `zArrow { from: { stepId, portId }, to: { stepId, portId } }`; `zLoopBack { from, to (step ids), max: int 1 to 10 }`, `LOOP_BACK_MAX_DEFAULT = 3`; `zCommandRef { id }`.
  - `zProcessDefinition { schemaVersion: z.literal(1), phases (1 to 20), steps (≤ 200), arrows (≤ 600), loopBacks (≤ 50), commands (≤ 50) }`, `ProcessDefinition`.
  - The sealed part: `zSealedItem { key: zBytes(60, 60), ciphertext: zBytes(16, 65536) }` in `packages/contracts/src/keys/sealed.ts` (the vault's `SealedItem`, opaque to the server; shared with PROJET-6 and BOUCLE-1, created by whichever of the three merges first); its plaintext once opened, `zProcessSealedPayload { commands: z.record(zProcessId, { run (1 to 4000), where: 'project' | 'worktree', healthUrl?: an http(s) URL }) }`; `processSealAad(projectId) = 'process:' + projectId` and `templateSealAad(templateId) = 'template:' + templateId`.
- `packages/contracts/src/process/catalogue.ts`:
  - `STEP_KINDS` and `zStepKind`; `STEP_FAMILIES = ['agent', 'gate', 'command', 'core']`; `CAPABILITIES = ['agent', 'command', 'ci']`.
  - `CATALOGUE: Record<StepKind, StepKindSpec>`, `StepKindSpec { family, name, menu: 'process' | 'reviews' | 'runner' | null, judges, needs: Capability[] (any one suffices; empty: none), removable: 'yes' | 'never' | 'keep-one', unique, inputs: PortSpec[], outputs: PortSpec[], extraInputs: ArtifactType[] (the types of the Entrées the Pilote may add), role: AgentRole | null, skill: string | null, contrat: string | null }`, `PortSpec { id, types: ArtifactType[] (the first one is the default), note?, sameTypeAs?: portId }`:

    | kind | family | name | judges | needs | inputs → outputs | role, skill |
    |---|---|---|---|---|---|---|
    | `idea-analysis` | agent | « Analyse de l’Idée » | | agent | `idee` idea → `idee` idea | idea, `idea-analysis` |
    | `inventory` | agent | « Inventaire » | | agent | none → `inventaire` inventory | design, `inventory` |
    | `prd` | agent | « PRD » | | agent | `idee` idea → `prd` prd | design, `product-design` |
    | `mockups` | agent | « Maquettes » | | agent | `prd` prd → `maquettes` mockups | design, `visual-design` |
    | `technical-design` | agent | « Conception technique » | | agent | `prd` prd, `maquettes` mockups → `conception` technical-design | design, `technical-design` |
    | `split` | agent | « Découpage en Tickets » | | agent | `prd` prd, `maquettes` mockups, `conception` technical-design → `ticket` ticket | design, `plan-backlog` |
    | `code` | agent | « Code » | | agent | `ticket` ticket → `changement` code-change | code, `code` |
    | `review` | agent | « Review » | yes | agent | `changement` code-change, extra verdict → `verdict` verdict | review, `review` |
    | `cross-review` | agent | « Revue croisée » | yes | agent | `document` prd, technical-design, mockups, inventory → `verdict` verdict | review, `cross-review` |
    | `idea-triage` | gate | « Tri de l’Idée » | | | `idee` idea → `idee` idea (note « retenue ») | |
    | `approval` | gate | « Approbation » | yes | | `document` prd, mockups, technical-design, inventory, ticket, extra verdict → `document` (`sameTypeAs: document`) | |
    | `visual-review` | gate | « Revue visuelle » | yes | | `changement` code-change, `maquettes` mockups → `verdict` verdict | |
    | `command` | command | « Commande » | | command | `changement` code-change, extra any type → `verdict` verdict or delivery | |
    | `checks` | core | « Checks » | | ci or command | `changement` code-change → `verdict` verdict | |
    | `merge` | core | « Merge » | | | `changement` code-change, extra verdict → `changement` code-change (note « mergé ») | |

    `menu`: `process` for the agent kinds but `review` and `cross-review`, and for `idea-triage` and `approval`; `reviews` for `cross-review`, `visual-review`, `review`; `runner` for `command`; `null` for `checks` and `merge`. `removable: 'never'` for `checks` and `merge`, `'keep-one'` for `review` (a second Review may go, never the last), `'yes'` for the others; `unique: true` for `checks` and `merge`. `contrat` is `null` for every kind until the Étape's ticket writes its Contrat and sets its id here.
  - `AGENT_KINDS`: the kinds of the `agent` family, in the order of `STEP_IDS` today.
  - `defaultStep(kind, { id, phaseId, col, row })`: a `Step` with the kind's name, its default ports (each `PortSpec` with its first type and its note) and, for an agent kind, its Rôle and Skill as Outils; what the canvas adds from the menu (PROCESS-8).
  - `TOOL_CAPABILITIES`: `role` gives `agent`, `command` gives `command`, `connector` `github` gives `ci` (only when the code's Source is GitHub, PROCESS-2 checks it), `skill` and `mcp` give none.
- `packages/contracts/src/process/templates/process-crewdeck.ts`: `PROCESS_CREWDECK: ProcessDefinition`, `PROCESS_CREWDECK_NAME = 'Process Crewdeck'`, and `BUILTIN_TEMPLATES = { 'process-crewdeck': … }`, written from `process.html` and US-97:
  - Phases: `ph-idee` « Idée » (1, 1) `idea.noted`; `ph-conception` « Conception » (1, 2) `idea.retained`; `ph-dev` « Développement » (1, 3) `ticket.ready`.
  - « Idée »: `st-analyse` `idea-analysis` « Analyse de l’Idée » (1, 1), its Entrée `idee` with the note « notée par toi »; `st-tri` `idea-triage` « Tri de l’Idée » (2, 1), Sortie note « retenue ».
  - « Conception »: `st-prd` `prd` « PRD » (1, 1); `st-rc-prd` `cross-review` « Revue croisée du PRD » (2, 1), Entrée `document` prd; `st-ap-prd` `approval` « Approbation du PRD » (3, 1), Entrées `document` prd and `verdict`, Sortie `document` prd; `st-maquettes` `mockups` « Maquettes » (4, 1); `st-ap-maquettes` `approval` « Revue des maquettes » (5, 1), `document` mockups; `st-ct` `technical-design` « Conception technique » (1, 2); `st-rc-ct` `cross-review` « Revue croisée de la conception » (2, 2), `document` technical-design; `st-ap-ct` `approval` « Approbation de la conception » (3, 2), `document` technical-design and `verdict`; `st-decoupage` `split` « Découpage en Tickets » (4, 2); `st-ap-tickets` `approval` « Validation des Tickets » (5, 2), `document` ticket, Sortie note « prêt ».
  - « Développement »: `st-code` `code` « Code » (1, 1); `st-checks` `checks` « Checks » (2, 1) with the Outil `connector` `github`; `st-review` `review` « Review » (3, 1), Entrées `changement` and `verdict` (note « des checks »); `st-rv` `visual-review` « Revue visuelle » (3, 2); `st-merge` `merge` « Merge » (4, 1), Entrées `changement`, `v-review` (note « de la Review »), `v-rv` (note « de la Revue visuelle »), Sortie note « mergé ».
  - Every agent Étape with its kind's Rôle and Skill as Outils.
  - The 25 arrows of `process.html`, ports renamed as above: `st-analyse.idee → st-tri.idee`, `st-tri.idee → st-prd.idee`, `st-prd.prd → st-rc-prd.document`, `st-prd.prd → st-ap-prd.document`, `st-rc-prd.verdict → st-ap-prd.verdict`, `st-ap-prd.document → st-maquettes.prd`, `st-maquettes.maquettes → st-ap-maquettes.document`, `st-ap-prd.document → st-ct.prd`, `st-ap-maquettes.document → st-ct.maquettes`, `st-ct.conception → st-rc-ct.document`, `st-ct.conception → st-ap-ct.document`, `st-rc-ct.verdict → st-ap-ct.verdict`, `st-ap-prd.document → st-decoupage.prd`, `st-ap-maquettes.document → st-decoupage.maquettes`, `st-ap-ct.document → st-decoupage.conception`, `st-decoupage.ticket → st-ap-tickets.document`, `st-ap-tickets.document → st-code.ticket`, `st-code.changement → st-checks.changement`, `st-code.changement → st-review.changement`, `st-checks.verdict → st-review.verdict`, `st-code.changement → st-rv.changement`, `st-ap-maquettes.document → st-rv.maquettes`, `st-code.changement → st-merge.changement`, `st-review.verdict → st-merge.v-review`, `st-rv.verdict → st-merge.v-rv`.
  - Retours, each `max: 3`: `st-rc-prd → st-prd`, `st-rc-ct → st-ct`, `st-review → st-code`, `st-rv → st-code`, and one from each approval gate to the Étape that wrote its document: `st-ap-prd → st-prd`, `st-ap-maquettes → st-maquettes`, `st-ap-ct → st-ct`, `st-ap-tickets → st-decoupage` (8 in all). No Commande.
- `packages/contracts/src/process/index.ts` exporting the four files; `packages/contracts/src/index.ts` exports it.
- `packages/contracts/src/contrats/define.ts`: `STEP_IDS = AGENT_KINDS` (imported from the catalogue, which imports nothing of `contrats/`).
- `packages/contracts/src/registry.ts`: the entry `process-sealed` (`zProcessSealedPayload`, Go type `ProcessSealed`, which RUNNER-18 reads once it opened a version's sealed part); then `pnpm exec nx run contracts:generate`, its output committed.
- If PR #147 is not merged when this ticket starts: add `AGENT_ROLES`, `zAgentRole`, `AgentRole` to `values.ts` exactly as PARAM-1 writes them (same names, same order), and say so in the PR; the second to merge rebases.
- Tests `packages/contracts/src/process/*.spec.ts`: each schema's bounds (an id `Code`, a 61-character name, a `max` of 11, a `schemaVersion` of 2, a Phase carrying a `phaseId`: refused); `PROCESS_CREWDECK` parses, has 3 Phases, 17 Étapes, 25 arrows, 8 Retours, every agent Étape a Rôle and a Skill; every arrow joins a Sortie to an Entrée of the same type; `defaultStep` of each kind parses and its ports are its spec's; `STEP_IDS` equals the list of today; every non-null `contrat` is an id of `CONTRATS`.

## Decisions already made

- The four approval gates have their Retour although `process.html` draws only the Revues croisées' and the Boucle's: ADR 0011 hides « Demander des changements » on a judging Étape without a Retour, and US-11 sends a document back with changes (CONCEPTION-4, CONCEPTION-6, CONCEPTION-10).
- The document is one zod schema, stored and sent whole (ADR 0011, « A version is one immutable document »); no table per block.
- Ids are short strings the page chooses, unique in the definition (Phases and Étapes share one namespace; a port's id is unique in its Étape), stable across versions: the template's are the ones above, so that a diff and a pinned run name the same Étape whatever the version.
- The ports' types come from the catalogue: `cross-review` and `approval` take any of their listed document types (one Étape kind for « Approbation du PRD », « Revue des maquettes », « Validation des Tickets »), `approval`'s Sortie has the type of its Entrée `document`; `extraInputs` are the Entrées the Pilote may add (the Merge's Verdicts, the Review's Verdict of the checks).
- The catalogue's labels and default names are data in French in `packages/contracts`, as the Contrats' labels are: a name is copied into the definition when an Étape is added, and PROCESS-2's Manques build their labels from them.
- Default Skills are the names the Étape tickets already use (`idea-analysis`, `inventory`, `product-design`, `visual-design`, `technical-design`, `cross-review`, `plan-backlog`, `code`, `review`); the mockup's `analyse-idee` and `red-green` are filler and are not copied.
- « Inventaire » is in the catalogue but not in « Process Crewdeck » (absent from `process.html`); the Projet's preparation runs it (PROJET-4).
- The Phases « Idée » and « Conception » of « Process Crewdeck » repeat for each noted and each retained Idée (US-97), though `process.html` draws only the « Développement »'s « pour chaque ».
- `st-checks` carries the `connector` `github` Outil (the mockup's « CI du dépôt »), and the Merge none: the Merge needs no capability, it merges where the code's Source is (ADR 0012).
- Only the sealed part's plaintext is generated for Go: the Runner never reads a definition (the server sends each Session and each Commande what it needs), and `zTool`'s union inside an array is not one go-jsonschema types.
- `zSealedItem` has the vault's field names `{ key, ciphertext }`: it is the `{ wrappedKey, ciphertext }` of ADR 0011.

## Acceptance criteria

- [ ] `zProcessDefinition` parses `PROCESS_CREWDECK`, and refuses each out-of-bound field of the tests (with the path of the field).
- [ ] « Process Crewdeck » holds exactly the Phases, Étapes, positions, ports, Outils, 25 arrows and 8 Retours listed above, every arrow between two ports of the same type, from a Sortie to an Entrée.
- [ ] `CATALOGUE` has the 15 kinds of the table; `checks` and `merge` have `menu: null`, `unique: true`, `removable: 'never'`; `review` has `removable: 'keep-one'`; `defaultStep('code', …)` has the Rôle `code` and the Skill `code`.
- [ ] `STEP_IDS` is derived from the catalogue and equals the nine ids of today; every existing Contrat test passes unchanged.
- [ ] `contracts:generate` writes `process-sealed.schema.json` and `apps/runner/internal/contracts/process-sealed.go`, and leaves no diff when run again.

## Verification

- `pnpm exec nx test contracts -- src/process/ src/contrats/`
- `pnpm exec nx run contracts:generate` then `git diff --exit-code`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- `validateDefinition`, `findGaps` and their fixtures: PROCESS-2. The tables, the draft and the routes: PROCESS-3. The engine: PROCESS-4 to PROCESS-6.
- `diff.ts`: PROCESS-10. The Pilote's Modèles (`process_templates`): PROCESS-14. The « Livraison » Phase: PROCESS-13.
- Each Étape's Contrat and its id in `CATALOGUE`: the Étape's ticket (IDEE-2, PROJET-4, BOUCLE-3, BOUCLE-4, CONCEPTION-3 to CONCEPTION-9).

## Dependencies

- None.
