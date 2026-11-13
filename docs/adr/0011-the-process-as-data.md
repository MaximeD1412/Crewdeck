# The Process is data: versioned documents the server interprets

> **Status:** accepted, 2026-11-14. Amends [ADR 0001](0001-shape-of-the-system.md)
> (the server interprets the Projet's active version instead of a fixed
> state machine), [ADR 0002](0002-github-app.md) and
> [ADR 0004](0004-the-runner.md) (no more `.process.json`),
> [ADR 0003](0003-privacy-and-end-to-end-encryption.md) (what the server
> reads of a Process).

## Context

The Process was fixed (Idée → Conception → Tickets → Boucle). « Gestion du
process » ([feature PRD](../product/features/gestion-du-process.md),
US-92 to US-98, US-111) makes it each Projet's own: Phases holding Étapes
whose typed Entrées and Sorties are linked by arrows, Outils attached to
each Étape, « pour chaque » Phases, Retours with a maximum, Manques that
forbid activation, versions where work in progress finishes on the version
it started with, and Modèles de process. On 2026-11-13 no server code
sequenced the Process yet (no Projet, Ticket, Conception nor Boucle table):
only lists (`STEP_IDS`, `DECISION_KINDS`, `SENSITIVE_ACTION_IDS`). The
engine is built once, configurable from the start.

## Decision

### A version is one immutable document

- `packages/contracts/src/process/definition.ts` declares
  `ProcessDefinition` (zod, `schemaVersion: 1`):
  - `phases`: `{ id, name, col, row, forEach }`, `forEach` one of
    `null`, `idea.noted`, `idea.retained`, `ticket.ready` (a closed list at
    the MVP; a free filter comes with the Pilote's own Types d'artefact,
    US-108);
  - `steps`: `{ id, phaseId, kind, name, col, row, inputs, outputs, tools }`;
    `kind` an id of the catalogue (below); `inputs` and `outputs` are
    `{ id, type, note? }`, `type` an `ArtifactType`; `tools` are
    `{ kind: 'role', roleId }`, `{ kind: 'skill', skillId }`,
    `{ kind: 'mcp', name }`, `{ kind: 'command', commandId }`,
    `{ kind: 'connector', connector: 'github' }`;
  - `arrows`: `{ from: { stepId, portId }, to: { stepId, portId } }`;
  - `loopBacks`: `{ from: stepId, to: stepId, max }`, `max` 1 to 10,
    3 by default;
  - `commands`: `{ id, where: 'project' | 'worktree' }`, their text and
    health address being in the version's sealed part (below).
- Ids inside a definition are short strings unique in it (`st-code`,
  `ph-dev`), stable across versions, so that a diff and a pinned run name
  the same Étape. Positions are cells of a grid (`col`, `row`), a Phase's
  in the canvas and an Étape's in its Phase, as in the mockups.
- `ArtifactType` (`packages/contracts/src/process/artifact-types.ts`):
  `idea`, `prd`, `mockups`, `technical-design`, `inventory`, `ticket`,
  `code-change`, `verdict`, `delivery` (Idée, PRD, Maquettes, Conception
  technique, Inventaire, Ticket, Changement de code, Verdict, Livraison).
- Tables (`apps/server/src/process/`): `process_versions` (`projectId`,
  `number` from 1, `definition` jsonb, `sealed` jsonb, `activatedAt`,
  `activatedBy`), immutable once written; `process_drafts` (one per Projet
  at most: `definition`, `sealed`, `revision`, `baseVersion`);
  `process_templates` (below). Every version is kept.
- A definition is the whole Process of a Projet minus its Sources, which
  are a Projet's own ([ADR 0012](0012-sources-local-and-github.md)). Export
  and import of a Process or a Modèle (no story yet) would be this document
  as a file, its Commandes re-sealed by the importing browser.

### The catalogue

`packages/contracts/src/process/catalogue.ts` lists every `kind` with its
default name, ports, family, the capabilities it needs, whether it judges,
its default Rôle and Skill and its Contrat (`STEP_IDS` of
`contrats/define.ts` becomes this list):

| Family | Kinds |
|---|---|
| agent | `idea-analysis`, `inventory`, `prd`, `mockups`, `technical-design`, `split`, `code`, `review` (judges), `cross-review` (judges) |
| gate (the Pilote's) | `idea-triage`, `approval` (judges; « Approbation du PRD », « Revue des maquettes », « Validation des Tickets » are `approval` Étapes named apart), `visual-review` (judges) |
| command | `command` |
| core (Étapes du produit) | `checks`, `merge`: never in the catalogue's menu, never removed nor added |

Capabilities: an agent Étape needs `agent` (given by a `role` Outil), a
`command` Étape needs `command` (a `command` Outil), `checks` needs `ci` (a
`connector` Outil `github`, only when the Changement de code's Source is
GitHub) or `command`. A Serveur MCP gives nothing the core checks: it is
for the agents.

### Manques

`packages/contracts/src/process/gaps.ts` exports `findGaps(definition,
sources)`, a pure function: the page runs it on every edit, the server at
activation (422 `process.has-gaps`), the phone shows its result for the
draft. Each Manque has a kind, the block it points at and a French label:

| Kind | When |
|---|---|
| `input.unfed` | an Entrée no arrow reaches (a Phase's first Entrées are fed by its `forEach` item) |
| `source.missing` | a Type d'artefact some Étape passes has no Source |
| `capability.missing` | an Étape needs a capability no attached Outil gives |
| `merge.no-review` | no Verdict of a `review` Étape reaches the Merge |
| `merge.no-checks` | no Verdict of the `checks` Étape reaches the Merge |

The canvas refuses, before any Manque, what is never drawable: an arrow
between two different types, a Retour from an Étape that does not judge or
to an Étape of another Phase or not before it, a Phase inside a Phase,
removing `checks`, `merge` or the `review` (its Rôle changes instead), or a
Phase that holds them. A test per Manque and per refusal, on the same
fixtures in the page and the server.

### Drafts, activation, Modèles

- The draft is saved on every change: `PUT /api/projects/:id/process/draft`
  with the whole definition, its sealed part and the `revision` it was
  based on; another revision gets 409 `process.draft-stale` (two tabs).
  Its first save copies the active version.
- `POST /api/projects/:id/process/activate` is the Action sensible
  `process.activate`: the dialog lists the diff
  (`packages/contracts/src/process/diff.ts`, a pure function) and the work
  that stays on its version; the server refuses a draft with a Manque, then
  writes version n+1 and deletes the draft in one transaction with its
  event.
- A Modèle de process is a definition and its sealed part
  (`process_templates`: `pilotId`, `name` unique per Pilote, `fromProjectId`,
  `createdAt`), saved from a Projet's active version (`POST
  /api/process-templates`, `replace: true` to overwrite one of the same
  name, US-111), renamed (`PATCH`), deleted. « Process Crewdeck » is
  `packages/contracts/src/process/templates/process-crewdeck.ts`, data of
  the release, not a row. Creating a Projet copies the Modèle it chose into
  version 1, Commandes re-sealed for the Projet by the browser.

### The engine

`apps/server/src/process/engine/` interprets a Projet's versions:

- **A PhaseRun** (`phase_runs`: `projectId`, `processVersionId`, `phaseId`,
  `itemType`, `itemId`, `state` `running | waiting | done | stopped |
  failed`) is one item through one Phase, pinned to the version active
  when it starts. Activation never touches a running PhaseRun: a Ticket
  taken after it follows the new version, even if its Conception ran on
  the old one.
- **A StepRun** (`step_runs`, RUNNER-12's table, gaining `phaseRunId`,
  `stepId`, `iteration`, `outputs`) is one pass of an Étape. An Étape
  starts when every Entrée has an Artefact: the item for a Phase's first
  Entrées, else the `outputs` of the StepRun its arrow comes from, in the
  same PhaseRun. An arrow leaving a Phase feeds the next Phase: a
  `forEach` Phase gets each Artefact as an item; a Phase with no `forEach`
  starts a PhaseRun per arrival, one at a time per Projet, in order (the
  « Livraison » after each merge).
- **Admission** of the items of a `forEach` Phase: `idea.noted` at once;
  `idea.retained` on « Démarrer la Conception » (US-8); `ticket.ready` by the
  Boucle (`AgentLoop`, started, stopped, planned as US-13 and US-62 say), one
  Ticket at a time per Projet at the MVP.
- **Step kinds** register a handler (`start`, `onSignal`) in
  `apps/server/src/process/engine/kinds/`: an agent Étape asks the Runner for
  a Session with its Rôle, Skill, Serveurs MCP and Contrat; a gate raises
  its Décision; a `command` asks the Runner to run it
  ([ADR 0013](0013-commandes-and-serveurs-mcp.md)); `checks` waits for the
  CI of the judged SHA or runs its Commandes; `merge` merges at the SHA every
  Verdict judged ([ADR 0002](0002-github-app.md), or the Runner for Local,
  [ADR 0012](0012-sources-local-and-github.md)). The domain modules
  (`ideas`, `designs`, `tickets`, `loops`, `sessions`, `decisions`) keep
  their tables and are called by the handlers.
- **A Retour** is taken when the Étape it leaves gives a Verdict
  « changements »: the StepRuns from its target on run again, `iteration`
  + 1. When the PhaseRun has taken it `max` times, the item stops on the
  Décision `loop-back.exhausted` (« Encore un passage », which allows one
  more, or « Arrêter »: the Ticket closed, the Conception abandoned), with
  its Session to read. An Étape that judges and has no Retour cannot ask for
  changes: its « Demander des changements » is hidden, and a Review's
  « changements » stops the item on the same Décision without « Encore un
  passage ».

### What the server reads of a Process

The structure, the catalogue ids, the names of Phases, Étapes, Rôles,
Serveurs MCP and Modèles are configuration the server reads (ADR 0003's
table gets a row). A Commande's text and its health address are not: the
version's `sealed` part (`{ wrappedKey, ciphertext }`, one item key wrapped
by the vault key, AES-256-GCM, additional data `process:<projectId>` or
`template:<templateId>`) holds `{ commands: { [id]: { run, healthUrl? } } }`.
The browser seals it; the Runner opens it and runs only what it opened.
Because the server has no vault key, it cannot forge a Commande the
Runner would run: a compromised server is not code execution on the
Pilote's machine (risk SEC-11). Replaying a Commande of an older version of
the same Projet stays possible and is accepted.

### No more `.process.json`

The Process never lives in a file of the repository (feature PRD). The
server stops writing `.process.json` (`commitProcessJson` and
`readProcessJson` leave `apps/server/src/github/`, the path leaves
`ALLOWLISTED_PATHS`). The integration and release branches are Paramètres
of the Projet; the worktree's preparation and cleaning, `agentLoop.setupCmd`
and `dropCmd` until now, are the Projet's two Commandes « Préparer le
worktree » and « Nettoyer le worktree » in its Paramètres, sealed like any
Commande. This repository keeps its own `.process.json` for the dotfiles'
tools.

## Options that lost

- **Normalised tables** (phases, steps, ports, arrows): a version is a
  snapshot edited as a whole; rows would add joins and nothing else.
- **The fixed Process with a configurable layer on top**: two engines,
  while nothing of the fixed one was built.
- **Manques checked by the server only**: the canvas needs them on every
  edit, and one rule must answer in both places.
- **A draft kept in the browser**: the phone reads the draft (US-98).
- **A graph library** (`@xyflow/system`, free positions): the mockups lay
  cards on a grid and route arrows in its gutters; a Skin redraws the
  canvas without depending on a library.
- **Commandes readable by the server**: a server compromised, or a bug,
  would run anything on every Runner.

## Consequences

- `packages/contracts/src/process/` gets the definition, the catalogue,
  `findGaps`, `diff` and « Process Crewdeck », each with its tests;
  `contrats/define.ts` takes its step ids from the catalogue.
- New event resources `process`, `process-template`, `phase-run`; new
  Action sensible `process.activate`; new Décision kind
  `loop-back.exhausted`.
- The Composants `ProcessCanvas`, `Phase`, `StepCard`, `Port`, `ToolChip`,
  `LoopBack`, `PhaseGroup`, `StepRow`, `Stepper`, `Menu`, `Toast` of
  `design/DESIGN.md` emit actions (move, connect, attach, set a maximum);
  the core checks them with the same contracts functions before it changes
  the draft.
- The first files to imitate: `packages/contracts/src/process/gaps.ts`
  (a pure rule with its fixtures), `apps/server/src/process/engine/kinds/`
  (one handler per kind).
