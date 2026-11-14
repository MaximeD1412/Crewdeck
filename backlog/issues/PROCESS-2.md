---
id: PROCESS-2
title: "The canvas's rules: validateDefinition refuses what is never drawable, findGaps lists the five Manques, one set of fixtures"
epic: PROCESS
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [PROCESS-1]
adr: [0011]
risques: [AGT-9]
stories: [US-94]
screens: []
revue_visuelle: false
video: false
---

## Context

US-94: an arrow is accepted only from a Sortie to an Entrée of the same Type d'artefact, the canvas lists every Manque pointing at its block, and a Process with a Manque cannot be activated. ADR 0011, « Manques »: two pure functions of `packages/contracts/src/process/gaps.ts` answer in both places. `validateDefinition` refuses what is never drawable (the canvas before each change, PROCESS-8 and PROCESS-9; the server on each draft save, PROCESS-3, and at activation, PROCESS-10); `findGaps` lists the Manques (the panel on each edit, PROCESS-7; activation's 422 `process.has-gaps`, PROCESS-10; the phone, PROCESS-11). Risk AGT-9 (« Un Process mal composé tourne sans fin ou merge sans garde-fou »): no cycle but a Retour, the core's Étapes never removed, a test per Manque and per refusal, on the same fixtures in the page and the server.

## Current state of the code

- Created by PROCESS-1: `packages/contracts/src/process/` (`zProcessDefinition`, `ARTIFACT_TYPES` and their labels, `FOR_EACH`, `CATALOGUE` with each kind's `judges`, `needs`, `removable`, `unique`, `PortSpec`s and `extraInputs`, `TOOL_CAPABILITIES`, `PROCESS_CREWDECK`).
- The fixtures' place: `packages/contracts/fixtures/<area>/` (`crypto/*.json`, `runner/*.json`, `contrats/example.ts` whose JSON `contracts:generate` writes); the web's tests read them by relative path (`apps/web/src/keys/vault.spec.ts`: `'../../packages/contracts/fixtures/crypto/'`).
- No Source on develop: SOURCE-1 creates `artifact_sources`; this ticket only types what `findGaps` receives.

## To do

- `packages/contracts/src/process/sources.ts`: `SOURCE_GROUPS = ['ticket', 'code']`, `SOURCE_KINDS = ['local', 'github']`, `ProcessSources = Record<SourceGroup, SourceKind | null>`, and `TYPE_SOURCE: Record<ArtifactType, SourceGroup | 'crewdeck' | 'none'>` (ADR 0012, « Which Source for what »): `ticket` → `ticket`; `prd`, `mockups`, `technical-design`, `inventory`, `code-change`, `verdict` → `code`; `idea` → `crewdeck`; `delivery` → `none`.
- `packages/contracts/src/process/gaps.ts`:
  - `validateDefinition(definition: ProcessDefinition): Refusal[]`, `Refusal { kind, target, label }`, `target` the dotted path of the block (`steps.st-merge`, `steps.st-merge.inputs.v-review`, `arrows.3`, `loopBacks.0`, `phases.ph-dev`); the kinds, each with its French label built from the blocks' names:
    - `id.duplicate`: two Phases or Étapes with one id, or two ports of an Étape;
    - `ref.unknown`: an Étape in a Phase that does not exist, an arrow or a Retour naming a missing Étape or port, a `command` Outil naming a missing `commands` entry;
    - `position.taken`: two Phases on one cell, two Étapes of a Phase on one cell;
    - `for-each.duplicate`: two Phases with the same `forEach`;
    - `step.ports`: a port whose type its kind does not allow (`PortSpec.types`, `sameTypeAs`, `extraInputs`), a default port missing;
    - `step.tools`: a Rôle or a Skill on an Étape that is not an agent's, two Rôles or two Skills on one Étape;
    - `arrow.direction`: an arrow not from a Sortie to an Entrée;
    - `arrow.type-mismatch`: « Une Sortie <type> ne va que vers une Entrée <type> »;
    - `arrow.cycle`: an arrow that closes a cycle of arrows (Retours apart): « Cette flèche ferait une boucle : une boucle n'existe que comme Retour, avec son maximum. »;
    - `input.many-arrows`: two arrows into one Entrée;
    - `loop-back.not-judging`, `loop-back.other-phase`, `loop-back.not-before` (its target must reach its source by arrows inside the Phase), `loop-back.many`: a second Retour leaving one Étape;
    - `core.missing`: no `checks`, no `merge` or no `review` (« « Checks », « Merge » et une Review sont dans chaque Process : ils ne se retirent pas »), which is also what removing a Phase that holds one of them gives;
    - `core.duplicate`: a second `checks` or `merge`.
  - `findGaps(definition: ProcessDefinition, sources: ProcessSources): ProcessGap[]`, `ProcessGap { kind, target, label }`, in the order of the definition's blocks, each kind with the label of `process-manques.html`:
    - `input.unfed`, target `steps.<id>.inputs.<port>`: an Entrée no arrow reaches, unless its Phase has a `forEach` whose type is the Entrée's (fed by the item): « Entrée « Verdict de la Review » de « Merge » : rien ne l’alimente » (the port's label is its type's, then its note);
    - `source.missing`, target `sources.<type>`: a Type d'artefact some Étape passes (a port of that type) whose `TYPE_SOURCE` group has no Source in `sources`: « Inventaire : aucune Source »;
    - `capability.missing`, target `steps.<id>`: an Étape whose kind `needs` capabilities and no attached Outil gives one of them, `ci` counting only when `sources.code` is `github`: « « Tests de bout en bout » a besoin d’une Commande : aucun Outil attaché n’en donne » (« d’un Rôle », « d’une Commande », « de la CI du dépôt ou d’une Commande »);
    - `merge.no-review`, target `steps.<merge>`: no path of arrows from a `verdict` Sortie of a `review` Étape to an Entrée of the Merge: « « Merge » merge un Changement de code sans Review avant lui »;
    - `merge.no-checks`, same with the `checks` Étape: « « Merge » merge un Changement de code sans checks avant lui ».
  - Both pure, synchronous, without I/O; `findGaps` assumes a definition `validateDefinition` accepts.
- Fixtures `packages/contracts/fixtures/process/`:
  - `cases.ts`: one case per refusal kind and per Manque kind (and a few combined), each a named change of `PROCESS_CREWDECK` (`remove the arrow st-review.verdict → st-merge.v-review`, `add an arrow st-merge.changement → st-code.ticket`) with its `sources` and the expected `refusals` and `gaps` (kind and target);
  - `contracts:generate` writes each case to `fixtures/process/<case>.json` `{ definition, sources, refusals, gaps }` (as it writes `fixtures/contrats/example.json`); the JSON is committed.
- `packages/contracts/src/process/gaps.spec.ts`: walks every JSON of `fixtures/process/` and checks both functions give exactly its `refusals` and `gaps`; `PROCESS_CREWDECK` has no refusal and, with both groups on GitHub, no Manque; with both groups `local` it has one Manque, `capability.missing` on `st-checks`.
- `docs/pilotage/risques.json`, AGT-9: tick « Les flèches ne forment jamais de cycle : une boucle n'existe que comme Retour » and « Un test par Manque et par refus du canevas », `statutDepuis` dated.

## Decisions already made

- Two functions, not one: a refusal is never saved (422 `process.invalid` on the draft, PROCESS-3), a Manque is saved in the draft and only forbids activation.
- Labels are French strings built in `gaps.ts`, as the Contrats' labels are, so that the page, the server's 422 `fields` and the phone show the same sentence; no `t()` key for them.
- « Checks », « Merge » and a Review are required in every definition: every definition descends from « Process Crewdeck », which has them, and none can be removed. A second Review may be removed, never the last.
- A Retour goes back « before » its Étape when its target reaches its source by arrows inside their Phase (`st-review → st-code`, since `st-code.changement → st-review.changement`); a Retour to itself is `loop-back.not-before`.
- One arrow per Entrée and one Retour per Étape: the engine feeds an Entrée from one Sortie, and a « changements » takes one Retour.
- `merge.no-checks` and `merge.no-review` follow arrows transitively: the checks' Verdict reaching the Review, whose Verdict reaches the Merge, counts (« Process Crewdeck »).
- `source.missing` checks the groups of ADR 0012: the Idée is « Crewdeck », the Livraison has no Source, the Verdict and the documents follow the code.
- The fixtures are JSON generated from TypeScript cases: the server's tests (PROCESS-3, PROCESS-10) and the page's (PROCESS-7, PROCESS-8) read the same files.

## Acceptance criteria

- [ ] Each refusal kind has a fixture where `validateDefinition` returns exactly it, with its target; each Manque kind has a fixture where `findGaps` returns exactly it.
- [ ] Removing the arrow `st-review.verdict → st-merge.v-review` gives `input.unfed` on `st-merge.inputs.v-review` and `merge.no-review` and `merge.no-checks` (the checks reached the Merge only through the Review).
- [ ] An arrow `st-merge.changement → st-code.ticket` is `arrow.type-mismatch`; an arrow whose `to` is a Sortie (`st-code.changement`) is `arrow.direction`; an arrow from `st-review.verdict` to a second Verdict Entrée of `st-review` itself is `arrow.cycle`; a second arrow into `st-merge.v-review` is `input.many-arrows`.
- [ ] A Retour from `st-code` (which does not judge) is `loop-back.not-judging`; from `st-review` to `st-prd` is `loop-back.other-phase`; from `st-rc-prd` to `st-ap-prd` is `loop-back.not-before`.
- [ ] A definition without `st-checks`, or without its Phase « Développement », is `core.missing`; a second `merge` is `core.duplicate`.
- [ ] An Étape `command` without a `command` Outil is `capability.missing`; `st-checks` with only the `github` connector and `sources.code: 'local'` is `capability.missing`; with a `command` Outil it is not.
- [ ] `sources.ticket: null` gives `source.missing` on `sources.ticket`.
- [ ] `PROCESS_CREWDECK` has no refusal and no Manque with both groups on GitHub.
- [ ] Running `contracts:generate` twice leaves no diff.

## Verification

- `pnpm exec nx test contracts -- src/process/`
- `pnpm exec nx run contracts:generate` then `git diff --exit-code`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- Calling the rules: the draft's save (PROCESS-3), the canvas (PROCESS-7 to PROCESS-9), activation (PROCESS-10), the phone (PROCESS-11).
- The Sources' table and their defaults: SOURCE-1. `diff.ts`: PROCESS-10.

## Dependencies

- PROCESS-1.
