---
id: PROCESS-13
title: "The « Livraison » Phase: a Commande « Lancer » after each merge, one at a time and in order, « Lancement échoué » in « À toi »"
epic: PROCESS
type: feature
priority: P1
size: S
milestone: M4 Boucle
blocked_by: [PROCESS-5, PROCESS-12, BOUCLE-4]
adr: [0011, 0013]
risques: []
stories: [US-105]
screens: [a-toi-process]
revue_visuelle: true
video: false
---

## Context

US-105: the Pilote adds a « Livraison » Phase after the Merge, with a Commande « Lancer » (`docker compose up -d`, a script) run after each merge, one at a time, in order, its failure raising a Décision; it is what takes the feature PRD's first extreme case (all Local) from the Idée to a running app. Nothing new is drawn: the Pilote adds the Phase and the Commande Étape with PROCESS-8 and PROCESS-9, and arrows the Merge's Sortie « Changement de code (mergé) » to its Entrée. ADR 0011 (« Starting a PhaseRun »): a Phase with no `forEach` starts a PhaseRun each time its first Entrées get an Artefact, one at a time per Projet, in order. This ticket makes that path real end to end: the Merge's output carrying the merged SHA, the Livraison PhaseRun running the Commande at that SHA in the Projet's place, the queue held while a Livraison waits on its Décision, and the Livraison's own copy in « À toi ».

## Current state of the code

- `apps/web/src/views/decisions/registry.ts`: `DecisionView` (`kindLabel` added by PROCESS-12).
- No `apps/server/src/process/` on develop.
- Created by PROCESS-4: `phase_runs` (`state` `running | waiting | done | stopped | failed`), `step_runs.outputs` (`{ portId, type, id, sha? }`), the kind registry. Created by PROCESS-5: lineage (`parentPhaseRunId`), Entrées fed across Phases, the PhaseRuns of a Phase without `forEach` started one at a time per Projet, in order.
- Created by PROCESS-12: `CommandRunsService.start`, `command_runs`, the `command` kind handler, the Décisions `command.failed` and `command.timeout` (« Relancer », « Arrêter »), the output panel `?commande=<runId>`, `apps/web/src/process/sealed.ts`.
- Created by BOUCLE-4: the `merge` kind handler, merging at the SHA every Verdict reaching the Merge judged (GitHub, or `merge.local` through SOURCE-5), its output `{ portId, type: 'code-change', id, sha: mergeSha }`.
- Created by RUNNER-18: `where: project` run in the Projet's folder, or for a Projet without one in `~/.crewdeck/worktrees/<projectId>/integration` moved to the run's `ref.sha` (to `origin/<integrationBranch>` when `sha` is null); `CREWDECK_SHA`, `CREWDECK_TICKET` from `ref`. Created by RUNNER-19: a Commande with a health address kept as a service, stopped before its next run.

## To do

- `apps/server/src/process/engine/kinds/command.ts` (PROCESS-12's): the run's `ref` for an Entrée `code-change` coming from a merge is `{ stepId, sha: <merged SHA>, ticket: <the Ticket of the parent PhaseRun>, branch: null }`, so that `where: project` runs at the merged commit.
- `apps/server/src/process/engine/queue.ts` (PROCESS-5's in-order start of a non-repeated Phase): a PhaseRun `failed` with an open `command.failed` or `command.timeout` Décision holds the next ones of the same Phase and Projet; « Relancer » that passes, or « Arrêter », lets the next one start. Each waiting item starts in the order of its Artefact (the merges' order), none skipped nor merged into another.
- A passed « Lancer »: its Sortie `delivery` is `{ portId, type: 'delivery', id: runId }`; the PhaseRun `done`.
- « À toi » (`apps/web/src/views/decisions/command.ts`, PROCESS-12's view): `kindLabel` « Lancement échoué » when the failed Étape has a Sortie of type `delivery` (`params.delivers: true`, set by the handler from the pinned definition), else PROCESS-12's « Commande échouée »; meta « <Projet> · <Phase> » (« Recettes · Livraison »); the output panel's Banner title the same (« Lancement échoué »).
- t() keys `decision.kind.command.failed.delivery` and `commandRun.banner.delivery` in `packages/sdk/src/i18n/fr.ts`.
- Fixture `packages/contracts/fixtures/process/livraison-local.json` (walked by PROCESS-2's `gaps.spec.ts`, `refusals: []`, `gaps: []`, both groups `local`): « Process Crewdeck » with a Commande Outil on `st-checks`, plus a Phase « Livraison » (no `forEach`) holding a `command` Étape « Lancer » (Entrée `changement` noted « mergé », Sortie `delivery`) and the arrow from the Merge's Sortie (the `delivery` type asks no Source, `TYPE_SOURCE`).
- The `a-toi-process` scenario (PROCESS-12's) gets its « Lancer · Recettes » row with `delivers: true`.

## Decisions already made

- Mockup: `a-toi-process` (page `design/screens/crewdeck/a-toi-process.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. Only the « Lancement échoué » row is this ticket's; the other rows are their kinds' tickets.
- No « Livraison » preset in the catalogue Menu: the Pilote adds it as any Phase and any Commande Étape (PROCESS-8, PROCESS-9).
- A Livraison runs for each merge, in order, even when a newer merge waits: « one at a time, in order » (US-105), never coalesced.
- A failed Livraison holds the later ones: launching a newer commit over a failed one would hide the failure.
- The Livraison's PhaseRun has the merged Ticket's Développement as `parentPhaseRunId` (PROCESS-5's lineage), which gives `CREWDECK_TICKET`.
- A merge by the Pilote outside the Boucle (on GitHub) is not a Merge Étape's output and starts no Livraison.

## Acceptance criteria

- [ ] On a Local Projet whose Process has the « Livraison » fixture, merging Ticket #12 starts one Livraison PhaseRun whose run has `ref.sha` the merged SHA and `ref.ticket` 12, `where: project` (integration test with the fake Runner).
- [ ] Merging #12 then #14 runs « Lancer » for #12 then for #14, never both at once.
- [ ] « Lancer » failing for #12 raises « Lancement échoué » « Lancer · Recettes » with meta « Recettes · Livraison »; #14's Livraison waits; « Relancer » passing then starts #14's; « Arrêter » instead also starts #14's.
- [ ] A passed « Lancer » ends its PhaseRun `done` with a `delivery` output whose id is the run's.
- [ ] `livraison-local.json` gives no refusal and no Manque.
- [ ] `a-toi-process` matches its mockup at 390 and 1280 px (Playwright against the fake Runner, axe without violations); the captures come from those tests.

## Verification

- `pnpm exec nx test contracts -- src/process/gaps.spec.ts`
- `pnpm exec nx test server -- src/process/engine/queue.spec.ts`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- livraison`
- `pnpm exec nx e2e web -- command.spec.ts`; `scripts/captures.sh a-toi-process` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The Commande's form, its sealing, `command_runs` and the output panel: PROCESS-12. A process kept running after its health address answers: RUNNER-19.
- The Merge itself: BOUCLE-4, SOURCE-5 for Local.
- Adding the Phase and the Étape on the canvas: PROCESS-8, PROCESS-9.

## Dependencies

- PROCESS-5
- PROCESS-12
- BOUCLE-4
