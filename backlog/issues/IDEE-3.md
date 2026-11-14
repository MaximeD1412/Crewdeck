---
id: IDEE-3
title: "Triage of an Idée: the idea-triage gate (retain, merge, reject) and back to triage"
epic: IDEE
type: feature
priority: P0
size: M
milestone: M5 Idées
blocked_by: [IDEE-2]
adr: [0003, 0007, 0008, 0011]
risques: []
stories: [US-7, US-91]
screens: [idee-retenue, idee-fusion, idee-rejetee]
revue_visuelle: true
video: false
reprend: 70
---

## Context

US-7: the Pilote retains, merges or rejects an Idée, so that only what is worth it goes to Conception. US-91: a merged or rejected Idée can be put back to triage, keeping its analysis, which they can run again, so that a wrong click is never final. A retained Idée is what CONCEPTION-1 starts a Conception from. The model is the dotfiles `ideas` tool (`MaximeD1412/dotfiles`, `agents/tools/ideas/README.md`: `merge`, `reject`, `design`, `triage`).

The refonte (PRD #169, ADR 0011) makes the triage the `idea-triage` **gate** of the « Idée » Phase (« Tri de l'Idée » in « Process Crewdeck »: Entrée an Idée, Sortie the retained Idée), run by a kind handler of PROCESS-4's engine: its StepRun waits for the Pilote, « Retenir » passes it and its Sortie feeds, by lineage, the Phase « pour chaque Idée retenue » that CONCEPTION-1 admits into. The retained Idée's page shows what its Projet's Process will run, never a list of Étapes optionnelles (US-83 is removed: an Étape runs because it is in the Process).

## Current state of the code

- No `apps/server/src/ideas/` on develop; `DECISION_KINDS` has `ideas-to-triage`.
- Created by IDEE-1: `Idea` (`state`, `mergedIntoId`, `reason`, `triagedAt`), `apps/server/src/ideas/`, `syncIdeasToTriage`, the plaintext cache, the `/idees` list and its tabs.
- Created by IDEE-2: the Idée page `/idees/:id` (`PageIdee` with its `actions` slot), the « Analyse » aside of the list, `POST /api/ideas/:id/reanalyse`, `apps/web/src/views/idee.ts`, the Idée's admission into the « Idée » Phase, the `idea-analysis` kind handler.
- Created by PROCESS-1: the `idea-triage` kind (family gate, judges) in `packages/contracts/src/process/catalogue.ts`. By PROCESS-3: `GET /api/projects/:id/process` (the active version) and the event resource `process`. By PROCESS-4: `phase_runs`, `step_runs`, `engine/kinds/`, the rerun of an Étape in a PhaseRun (used by ATOI-2's rerun), events `phase-run`, `step-run`.
- Created by UI-4 / UI-6: `Dialog`, `Radio`, `TextField`, `ProcessTrack`.
- No triage command.

## To do

- **Kind handler** `apps/server/src/process/engine/kinds/idea-triage.ts` (kind `idea-triage`), its domain part in `apps/server/src/ideas/triage.ts`:
  - `start(tx, stepRun)`: no Session; the StepRun waits for the Pilote; the Idée is `analysed` (or `to-triage` when its Entrée is an Idée without analysis); `syncIdeasToTriage` counts it in the `ideas-to-triage` Décision.
  - The four commands below finish or reopen that StepRun; when the Idée's PhaseRun has no waiting `idea-triage` StepRun (its Process has no triage gate), they change the Idée alone.
- **Contracts** (`packages/contracts/src/api/ideas.ts`): `zRetainIdeaInput = { seq }`, `zMergeIdeaInput = { targetId: zId, seq }`, `zRejectIdeaInput = { reason: zSealedItem | null, seq }`, `zReopenIdeaInput = { seq }`; all return `zIdea`.
- **Routes** in `ideas.controller.ts`, each in one transaction with `idea.upserted`, the `step-run` and `phase-run` events and `syncIdeasToTriage`, each checking `seq` (409 `realtime.stale`):
  - `POST /api/ideas/:id/retain`: from `to-triage` or `analysed` → `retained`, `triagedAt`; the gate's StepRun passes (Verdict « approuvé ») with its output `{ type: 'idea', id }` on its Sortie; the PhaseRun ends when it was its last Étape. 422 `ideas.not-triageable` otherwise.
  - `POST /api/ideas/:id/merge`: from `to-triage` or `analysed` → `merged`, `mergedIntoId = targetId`; the gate's StepRun ends with outcome `merged`, the PhaseRun `stopped`. The target must be the Pilote's (404), not itself (422 `ideas.merge-into-self`), in `analysing`, `to-triage`, `analysed` or `retained` (422 `ideas.merge-target-closed`). The target's `idea.upserted` is written too (its « Fusionnées ici » list).
  - `POST /api/ideas/:id/reject`: from `to-triage` or `analysed` → `rejected`; `reason` sealed by the browser (optional); the gate's StepRun ends with outcome `rejected`, the PhaseRun `stopped`.
  - `POST /api/ideas/:id/reopen` (« Remettre à trier », US-91): from `merged` or `rejected` → `analysed` when it has an analysis, else `to-triage`; `mergedIntoId` and `reason` cleared, `analysis`, `impact`, `effort`, duplicates kept; the PhaseRun back to `running` on its pinned version and a new StepRun of its triage gate (the engine's rerun). 422 `ideas.not-closed` otherwise; a `retained` Idée cannot be reopened (it may already have a Conception).
  - An Idée in `analysing` refuses the four with 422 `ideas.analysis-running` (IDEE-2's code).
  - Messages in `apps/server/src/errors/messages.ts`: `ideas.merge-into-self` « Une Idée ne peut pas être fusionnée dans elle-même. », `ideas.merge-target-closed` « Cette Idée est fermée : choisis une Idée ouverte. », `ideas.not-closed` « Seule une Idée fusionnée ou rejetée peut être remise à trier. ».
- **Web**:
  - `apps/web/src/api/ideas.ts`: `retain`, `merge`, `reject`, `reopen`.
  - On the Idée page and the list's aside, in the `actions` slot: « Retenir » (primary), « Fusionner… », « Rejeter » (ghost) for `to-triage` and `analysed`; « Remettre à trier » (primary) for `merged` and `rejected`, with the line « Rejetée par toi <time>. Remise à trier, elle revient « Analysée », avec son analyse d'avant, que tu peux relancer. » (« Fusionnée dans #n par toi <time>. … » for a merged one), and « Relancer l'analyse » once reopened (IDEE-2's `reanalyse`). While `analysing` the buttons are disabled with « L'analyse est en cours. ».
  - **Merge dialog** (`idee-fusion`): Composant `MergeIdeaDialog` (`packages/contracts/src/composants/merge-idea-dialog.ts`, `packages/skin-passerelle/src/merge-idea-dialog.ts`, in `COMPOSANTS`): « L'Idée #n <title> sera fusionnée dans celle que tu choisis. », a search field filtering in the browser on the decrypted cache (number and title), « Doublons possibles » first (the analysis' duplicates), then « Autres Idées de <Projet> », then the other open Idées; one `Radio` per Idée (number, title, Projet · state · time); « Fusionner dans #m » (disabled until a choice) and « Annuler ».
  - **Reject**: « Rejeter » opens a small `Dialog` with an optional reason (`TextField`, « Pourquoi ? (facultatif) ») sealed in the core before the call; « Rejeter » confirms.
  - **Retained Idée** (`idee-retenue`): the card « Ce qui va se passer »: a `ProcessTrack` « Idée retenue » then the Étapes, by name and in order (row, col), of the Phase whose `forEach` is `idea.retained` in the Projet visé's active version (PROCESS-3's `GET /api/projects/:id/process` through the front's query layer, refreshed on the `process` event), « Rôle <Rôle of its first agent Étape> · <Moteur> », and the link « Voir le Process » to `/projets/:id/process`; the « Analyse » card read-only. Without a Projet visé: « Choisis d'abord le Projet de cette Idée. »; a Process without such a Phase: « Le Process de <Projet> n'a pas de Conception. ». The primary « Lancer la Conception » is a slot left for CONCEPTION-1 (not rendered here).
  - **Rejected or merged Idée** (`idee-rejetee`): the « Historique » card, a `ProcessTrack` of Notée, Analysée, Rejetée (halt) / Fusionnée, with their times.
  - A merged Idée's target page lists « Fusionnées ici » (number, title from the cache).
  - The list's tabs (IDEE-1) move the Idée at once (optimistic update reverted on an error, the error's `message` shown).
  - Copy under `t('idee.triage.*')`.
- **Tests and scenarios**: `apps/server/src/testing/scenarios/idee-triage.ts` (`idee-retenue`, `idee-fusion`, `idee-rejetee`), `apps/web/e2e/idee-triage.spec.ts`.

## Decisions already made

- Mockup: `idee-retenue`, `idee-fusion`, `idee-rejetee` (pages `design/screens/crewdeck/idee-retenue.html`, `…/idee-fusion.html`, `…/idee-rejetee.html`; captures `design/screens/crewdeck/idee-retenue-390.png`, `…-1280.png` and the same for the other two). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The mockup's « Étapes optionnelles » card and its « activée » lines are not built (US-83 removed); « Lancer la Conception » is CONCEPTION-1's; « En faire un Ticket » IDEE-5's.
- The track of a retained Idée reads the Projet's **active** version: the Conception pins the version active when CONCEPTION-1 admits it, so what the card shows is what runs if the Pilote starts it now.
- None of these transitions is an Action sensible (US-26's list): no confirmation dialog for retain, merge or reopen; reject asks only for its optional reason.
- Merge and reject stop the Idée's PhaseRun (`stopped`), they do not fail it; reopening resumes the same PhaseRun on its pinned version rather than admitting a new one, so the analysis already done stays its output.
- A merged Idée does not move its text into the target (the server cannot read it). The dotfiles' « +25 % per extra request » score is not ported (no score at the MVP).

## Acceptance criteria

- [ ] « Retenir » on an analysed Idée makes it `retained`, passes its triage StepRun with the Idée as output, ends its PhaseRun, removes it from « À trier », adds it to « Retenues », and the `ideas-to-triage` count drops by one.
- [ ] « Fusionner dans #58 » makes #63 `merged` into #58 and stops its PhaseRun; #58's page lists #63 under « Fusionnées ici »; merging into itself or into a rejected Idée is refused with the message of `ideas.merge-into-self` / `ideas.merge-target-closed`.
- [ ] The merge dialog's search finds an Idée by a word of its title without any request to the server (Playwright watches the network).
- [ ] « Rejeter » with a reason stores it sealed; « Remettre à trier » brings the Idée back `analysed` with its previous analysis, its PhaseRun `running` with a new waiting triage StepRun, and « Relancer l'analyse » is offered.
- [ ] A retained Idée cannot be reopened (422 `ideas.not-closed`).
- [ ] An Idée whose Projet's Process has no triage gate is retained by the same button, without any StepRun.
- [ ] The retained Idée's page lists the Étapes of its Projet's Conception Phase from the active version; after a new version that removes « Maquettes » is activated, the card no longer shows it.
- [ ] Route baseline for the four routes: nominal matches `zIdea`; 400; 401; 404 for another Pilote's Idée; 409 stale `seq`; 422 for each rule.
- [ ] Each transition, its StepRun and PhaseRun changes and their events are written in one transaction (integration test).
- [ ] Playwright at 390 and 1280 px on the three states, axe without violations.

## Verification

- `pnpm exec nx test server -- src/ideas/triage.spec.ts src/process/engine/kinds/idea-triage.spec.ts`
- `pnpm exec nx test-integration server -- ideas`
- `pnpm exec nx test skin-passerelle -- src/merge-idea-dialog.spec.ts`
- `pnpm exec nx e2e web -- idee-triage.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`
- `scripts/captures.sh idee-retenue idee-fusion idee-rejetee`.

## For prod

Nothing.

## Out of scope

- Starting the Conception of a retained Idée: CONCEPTION-1.
- Turning an Idée into a Ticket: IDEE-5.
- Editing the Projet's Process: PROCESS-7 to PROCESS-9.
- The Journal des Décisions: US-78 (Bêta).

## Dependencies

- IDEE-2.
