---
id: IDEE-3
title: "Triage of an Idée: retain, merge, reject, and back to triage"
epic: IDEE
type: feature
priority: P0
size: M
milestone: M5 Idées
blocked_by: [IDEE-2]
adr: [0003, 0007, 0008]
risques: []
stories: [US-7, US-91]
screens: [idee-retenue, idee-fusion, idee-rejetee]
revue_visuelle: true
video: false
---

## Context

US-7: the Pilote retains, merges or rejects an Idée, so that only what is worth it goes to Conception. US-91: a merged or rejected Idée can be put back to triage, keeping its analysis, which they can run again, so that a wrong click is never final. A retained Idée is what CONCEPTION-1 starts a Conception from. The model is the dotfiles `ideas` tool (`MaximeD1412/dotfiles`, `agents/tools/ideas/README.md`: `merge`, `reject`, `design`, `triage`).

## Current state of the code

- Created by IDEE-1: `Idea` (`state`, `mergedIntoId`, `reason`, `triagedAt`), `apps/server/src/ideas/`, `syncIdeasToTriage`, the plaintext cache, the `/idees` list.
- Created by IDEE-2: the Idée page `/idees/:id` (`PageIdee` with its `actions` slot), the « Analyse » aside of the list, `POST /api/ideas/:id/reanalyse`, `apps/web/src/views/idee.ts`.
- Created by UI-4 / UI-6: `Dialog`, `Radio`, `TextField`, `ProcessTrack`.
- No triage command.

## To do

- **Contracts** (`packages/contracts/src/api/ideas.ts`): `zRetainIdeaInput = { seq }`, `zMergeIdeaInput = { targetId: zId, seq }`, `zRejectIdeaInput = { reason: zSealedItem | null, seq }`, `zReopenIdeaInput = { seq }`; all return `zIdea`.
- **Server** `apps/server/src/ideas/triage.ts` and routes in `ideas.controller.ts`:
  - `POST /api/ideas/:id/retain`: from `to-triage` or `analysed` → `retained`, `triagedAt`. 422 `ideas.not-triageable` otherwise.
  - `POST /api/ideas/:id/merge`: from `to-triage` or `analysed` → `merged`, `mergedIntoId = targetId`. The target must be the Pilote's (404), not itself (422 `ideas.merge-into-self`), in `analysing`, `to-triage`, `analysed` or `retained` (422 `ideas.merge-target-closed`). The target's `idea.upserted` is written too (its « Fusionnées » count).
  - `POST /api/ideas/:id/reject`: from `to-triage` or `analysed` → `rejected`; `reason` is sealed by the browser (optional).
  - `POST /api/ideas/:id/reopen` (« Remettre à trier », US-91): from `merged` or `rejected` → `analysed` when it has an analysis, else `to-triage`; `mergedIntoId` and `reason` cleared, `analysis`, `impact`, `effort`, duplicates kept. 422 `ideas.not-closed` otherwise. A `retained` Idée cannot be reopened (422 `ideas.not-closed`): it may already have a Conception.
  - Every transition writes `idea.upserted` and calls `syncIdeasToTriage` in its transaction; each checks `seq` (409 `realtime.stale`).
- **Web**:
  - `apps/web/src/api/ideas.ts`: `retain`, `merge`, `reject`, `reopen`.
  - On the Idée page and the list's aside, in the `actions` slot: « Retenir » (primary), « Fusionner… », « Rejeter » (ghost) for `to-triage` and `analysed`; « Remettre à trier » (primary) for `merged` and `rejected`, with the line « Rejetée par toi <time>. Remise à trier, elle revient « Analysée », avec son analyse d'avant, que tu peux relancer. » (« Fusionnée dans #n par toi <time>. … » for a merged one), and « Relancer l'analyse » once reopened (IDEE-2's `reanalyse`).
  - **Merge dialog** (`idee-fusion`): `MergeIdeaDialog` Composant (`packages/contracts/src/composants/merge-idea-dialog.ts`, skin implementation): the sentence « L'Idée #n <title> sera fusionnée dans celle que tu choisis. », a search field filtering in the browser on the decrypted cache (number and title), « Doublons possibles » first (the analysis' duplicates), then « Autres Idées de <Projet> », then the other open Idées; one `Radio` per Idée (number, title, Projet · state · time); « Fusionner dans #m » (disabled until a choice) and « Annuler ».
  - **Reject**: « Rejeter » opens a small `Dialog` with an optional reason (`TextField`, « Pourquoi ? (facultatif) ») sealed in the core before the call; « Rejeter » confirms.
  - **Retained Idée** (`idee-retenue`): the page shows the card « Ce qui va se passer » (the `ProcessTrack` Idée analysée et retenue → PRD → Maquettes (Étape optionnelle, its state for the Projet) → Conception technique → Tickets, « Rôle Conception · <Moteur> »), the « Analyse » card read-only, and « Étapes optionnelles · <Projet> » (each with « hérité du compte » or « modifié pour ce Projet » and activée/désactivée, from `SettingsService.effective` in the store's `settings` slice) with « Modifier dans les Paramètres du Projet » linking to `/projets/:id/parametres`. The primary « Lancer la Conception » is a slot left for CONCEPTION-1 (not rendered by this ticket).
  - **Rejected or merged Idée** (`idee-rejetee`): the « Historique » card, a `ProcessTrack` of Notée, Analysée, Rejetée (halt) / Fusionnée, with their times.
  - The list's tabs (IDEE-1) now move the Idée at once (optimistic update reverted on an error, the error's `message` shown).
  - Copy under `t('idee.triage.*')`.
- **Tests and scenarios**: `apps/server/src/testing/scenarios/idee-triage.ts` (`idee-retenue`, `idee-fusion`, `idee-rejetee`), `apps/web/e2e/idee-triage.spec.ts`.

## Decisions already made

- Mockup: `idee-retenue`, `idee-fusion`, `idee-rejetee` (pages `design/screens/crewdeck/idee-retenue.html`, `…/idee-fusion.html`, `…/idee-rejetee.html`; captures `design/screens/crewdeck/idee-retenue-390.png`, `…-1280.png` and the same for the other two). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. « Lancer la Conception » is CONCEPTION-1's; « En faire un Ticket » IDEE-5's.
- None of these transitions is an Action sensible (US-26's list): no confirmation dialog for retain, merge or reopen; reject asks only for its optional reason.
- A merged Idée does not move its text into the target (the server cannot read it): the target page lists « Fusionnées ici » (number, title from the cache) instead. The dotfiles' « +25 % per extra request » score is not ported (no score at the MVP).
- An Idée in `analysing` cannot be triaged until its analysis ends or fails: the buttons are disabled with « L'analyse est en cours. ».

## Acceptance criteria

- [ ] « Retenir » on an analysed Idée makes it `retained`, removes it from « À trier », adds it to « Retenues », and the `ideas-to-triage` label counts one less.
- [ ] « Fusionner dans #58 » makes #63 `merged` into #58; #58's page lists #63 under « Fusionnées ici »; merging into itself or into a rejected Idée is refused with the message of `ideas.merge-into-self` / `ideas.merge-target-closed`.
- [ ] The merge dialog's search finds an Idée by a word of its title without any request to the server (Playwright watches the network).
- [ ] « Rejeter » with a reason stores it sealed; « Remettre à trier » brings the Idée back `analysed` with its previous analysis, and « Relancer l'analyse » is offered.
- [ ] A retained Idée cannot be reopened (422 `ideas.not-closed`).
- [ ] Route baseline for the four routes: nominal matches `zIdea`; 400; 401; 404 for another Pilote's Idée; 409 stale `seq`; 422 for each rule.
- [ ] Each transition and its `idea.upserted` event are written in one transaction (integration test).
- [ ] Playwright at 390 and 1280 px on the three states, axe without violations.

## Verification

- `pnpm exec nx test server -- src/ideas/triage.spec.ts`
- `pnpm exec nx test-integration server -- ideas`
- `pnpm exec nx test skin-passerelle -- src/merge-idea-dialog.spec.ts`
- `pnpm exec nx e2e web -- idee-triage.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`
- `scripts/captures.sh` for `idee-retenue`, `idee-fusion`, `idee-rejetee`.

## For prod

Nothing.

## Out of scope

- Starting the Conception of a retained Idée: CONCEPTION-1.
- Turning an Idée into a Ticket: IDEE-5.
- The Journal des Décisions: US-78 (Bêta).

## Dependencies

- IDEE-2.
