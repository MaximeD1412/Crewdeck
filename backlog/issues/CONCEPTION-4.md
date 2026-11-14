---
id: CONCEPTION-4
title: "The approval gate of a document: review it, approve it (a merge bound to the SHA on GitHub or Local) or ask for changes"
epic: CONCEPTION
type: feature
priority: P0
size: M
milestone: M6 Conception
blocked_by: [CONCEPTION-3, CORE-7, SOURCE-5]
adr: [0002, 0003, 0006, 0007, 0008, 0011, 0012]
risques: [SEC-5]
stories: [US-11, US-26]
screens: [relecture, relecture-confirmation]
revue_visuelle: true
video: false
reprend: 79
---

## Context

US-11: the Pilote reviews a Conception document and either approves it or asks for changes, so that nothing is built they did not validate. ADR 0002: approving a document is merging its change after the product's confirmation (US-26, Action sensible `document.approve`), bound to the SHA the Pilote read and the Contrat passed. The refonte (PRD #169, ADRs 0011 and 0012) makes the review an `approval` **gate** of the Process (« Approbation du PRD », « Approbation de la conception », « Revue des maquettes », « Validation des Tickets » in « Process Crewdeck »), run by a kind handler of PROCESS-4's engine; the document lives on the code's Source, so approving merges a GitHub PR with `mergePullRequest` or, for a Local Projet, the local change into the folder through SOURCE-5's `merge.local`; « Demander des changements » is the gate's Verdict « changements », which takes its Retour back to the Étape that wrote the document (PROCESS-6), and is hidden when the gate has none. The document is read by the browser, from GitHub with the user token or from the Runner through the relay (SOURCE-4's reader), never by the server. This ticket builds the handler for document Entrées (PRD, Conception technique, Maquettes), the commands, and the review page of the PRD and the technical design; the mockups' page is CONCEPTION-6, the Tickets' gate CONCEPTION-10.

## Current state of the code

- `@SensitiveAction(id)`, `withSeq` and `SensitiveActionsService.assertFresh` (`apps/server/src/sensitive-actions/`), `confirmSensitiveAction` (`apps/web/src/dialogs/confirm.ts`); `SENSITIVE_ACTION_IDS` has `document.approve`; `DECISION_KINDS` has `document-review`. `GitHubClient` (`apps/server/src/github/github.client.ts`), `github.head-moved` in `apps/server/src/errors/messages.ts`.
- Created by CONCEPTION-1 to CONCEPTION-3: `Design`, `design_documents` (`changeNumber`, `branch`, `headSha`, `verdictSha`, `approvedSha`), the `prd` handler, the signals `document-voided` and `document-refreshed`, the remarks format (`packages/contracts/src/design/remarks.ts`, `renderRemarks`).
- Created by PROCESS-4: `engine/kinds/`, StepRun outputs. By PROCESS-6: the Verdict « changements » taking a Retour, `loop-back.exhausted`, « Demander des changements » hidden without a Retour.
- Created by SOURCE-5: `merge.local` (squash in the clone on the integration head, then `--ff-only` or `update-ref`), its answer, the `merge.local-blocked` Décision retried when the folder changes. By SOURCE-3: Local `code_changes` rows. By BOUCLE-1: GitHub `code_changes` rows.
- Created by SOURCE-4: the web document reader (GitHub fetcher with the user token, Local fetcher through `artifact.read`: `change`, `file`), Runner offline → title and state. By PROJET-5: the `DocumentReader` Composant.
- Created by IDEE-5 (M5): `apps/web/src/api/ticket-comments.ts` writing a comment on a Ticket or a change (GitHub with the user token, Local through BOUCLE-5's `comment.write`); written here under the same names if IDEE-5 is not merged.
- Created by CORE-3: `GitHubClient.mergePullRequest(repo, n, { sha, method })` (409 `github.head-moved`); by UI-6 / UI-7: `CheckRow`, `Message`; by UI-4: `TextField`, `Dialog`.

## To do

- **Kind handler** `apps/server/src/process/engine/kinds/approval.ts` (kind `approval`), domain `apps/server/src/designs/approvals.ts`, for a gate whose Entrée is a document (`prd`, `mockups`, `technical-design`; a `ticket` Entrée is CONCEPTION-10's):
  - `start(tx, stepRun)`: no Session; raises `document-review` (subject the gate's StepRun, label « <Type d'artefact> « <title> » », meta « <Projet> · Conception », context from the document's figures, « 12 stories, 2 questions ouvertes »).
  - `onSignal`: `document-voided` resolves the Décision (outcome `voided`); `document-refreshed` raises it again at the new head.
- **Contracts** (`packages/contracts/src/api/designs.ts`): `zApproveGateInput = { sha: string (40 hex), seq }`, `zRequestChangesInput = { commentId: string, seq }`, both → `zDesign`.
- **Routes** (`apps/server/src/designs/approvals.controller.ts`):
  - `POST /api/designs/:id/gates/:stepRunId/approve`, `@SensitiveAction('document.approve')`: the gate waits (422 `designs.not-waiting`), `sha === verdictSha` of its document and the authoring StepRun passed at it (422 `designs.contract-not-passed`). GitHub: `mergePullRequest(repo, changeNumber, { sha, method: 'squash' })`, a moved head → 409 `designs.head-moved`. Local: SOURCE-5's `merge.local` at that SHA (422 `runner.offline` from `RunnerCommands.send`); its answer finishes the approval as GitHub's does, a refusal is SOURCE-5's `merge.local-blocked`, the gate showing « merge en attente » until it succeeds. On the merge: `approvedSha` (the integration branch's new head), `approvedAt`, the gate's StepRun passed (Verdict « approuvé ») with output `{ portId: <its Sortie>, type, id: changeNumber, sha: approvedSha }`, the Décision resolved (outcome `approved`), `design.upserted`; the engine feeds the next Étapes. The GitHub merge is called before the transaction and its result recorded.
  - `POST /api/designs/:id/gates/:stepRunId/request-changes`: the gate waits (422 `designs.not-waiting`) and has a Retour in its pinned version (422 `designs.no-loop-back`); the browser already wrote the remarks comment on the change (`commentId`); the gate's Verdict « changements » (PROCESS-6 takes the Retour, or raises `loop-back.exhausted`), the Décision resolved (outcome `changes`).
  - Messages: `designs.not-waiting` « Ce document n'attend pas ta relecture. », `designs.contract-not-passed` « Le Contrat de ce document n'est pas rempli à cette version. », `designs.head-moved` « Le document a changé depuis ta relecture : relis-le à nouveau. », `designs.no-loop-back` « Ce Process ne prévoit pas de Retour depuis cette Étape. ».
- **Merged outside Crewdeck** (`document-changes.listener.ts`): the document's `code_changes` row becoming `merged` while its gate waits (a PR merged on GitHub, a Local branch the Pilote merged into the integration branch, seen by SOURCE-3) is an approval at the merge's head, next Étapes included (ADR 0002: a merge outside is read back like any other change).
- **Web**:
  - `/conceptions/:id/relecture/:stepId` for a gate whose Entrée is `prd` or `technical-design`: `apps/web/src/views/relecture.ts`, Composant `PageRelecture` (`packages/contracts/src/composants/page-relecture.ts`, skin implementation, in `COMPOSANTS`) with its `examples`.
  - The content: the change's Markdown files at `verdictSha`, through SOURCE-4's reader (GitHub: the PR's files then each file at the SHA; Local: `artifact.read` of the change then of each file), keyed by Projet + SHA + path; the PRD file first (the technical design: `AGENTS.md`, then `docs/adr/*`, then `CONTEXT.md`, then the rest), one tab per file, rendered by `DocumentReader`. A head that moved while reading shows a `caution` `Banner` « Le document a changé : recharge pour relire la dernière version. ». A Local Projet whose Runner is « hors ligne » shows the title and state only, « Le Runner est hors ligne : le document se lit quand il revient. », and « Approuver » disabled with that reason.
  - « Tes remarques »: selecting a passage and « Citer » puts « « <passage> » » in the remark field; each remark added is a `Message` (`from="pilote"`); the remarks live in the tab's memory only, said under the field: « Tes remarques partent sur le changement quand tu demandes des changements. ».
  - « Vérifications »: `CheckRow` « Contrat du <document> » (passed « rempli », failed with the count) from the authoring StepRun's verdict, and one `CheckRow` per Verdict Entrée of the gate (a Revue croisée: « <Moteur> · réglée », « N non retenues », CONCEPTION-8); no row when the gate has none.
  - « Demander des changements » (shown only when the gate has a Retour): one comment written with `ticket-comments.ts` (`kind: 'change'`), its body `renderRemarks(remarks)`, then `request-changes` with its id; disabled without a remark.
  - « Approuver le PRD » / « Approuver la conception technique »: an Action sensible: the core opens `confirmSensitiveAction` with the title « Approuver le PRD de « <title> » ? », the action label, and the consequences « Crewdeck va : merger la PR #n du PRD dans <integration branch> » (« le changement #n du PRD dans <integration branch>, dans ton dossier » for Local) « ; démarrer l'Étape <next> avec le Rôle <Rôle> (<Moteur>). », the next Étapes computed from the pinned definition's arrows out of the gate's Sortie; disabled during the Resynchronisation with its reason.
  - Copy under `t('relecture.*')`.
- **Tests and scenarios**: `apps/server/src/testing/scenarios/relecture.ts` (`relecture`, `relecture-confirmation`, the fake GitHub holding the mockup's PRD at a SHA; a Local variant with the fake Runner answering `artifact.read` and `merge.local`); `apps/web/e2e/relecture.spec.ts`.

## Decisions already made

- Mockup: `relecture`, `relecture-confirmation` (pages `design/screens/crewdeck/relecture.html`, `…/relecture-confirmation.html`; captures `design/screens/crewdeck/relecture-390.png`, `…-1280.png` and the same for the state). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. Its « désactivée » cross review line is not built.
- The approval binds three things to one SHA: the Pilote's reading (`sha` sent), the Contrat's verdict (`verdictSha`) and the merge (GitHub's merge API at `sha`, or SOURCE-5's squash of that SHA).
- Squash merge, as every merge by the product (ADR 0002, ADR 0012).
- The comment is written by the browser, as the Pilote: on GitHub with the user token, on Local sealed through the relay to `local.db`; the server gets only its id (ADR 0003). The Skill reads it through the Miroir (CONCEPTION-3's settle mode).
- « Demander des changements » exists only where the Process draws a Retour from the gate (ADR 0011): « Process Crewdeck » gives each of its approval gates one, to the Étape that wrote the document (PROCESS-1's Modèle).
- The confirmation is the core's, outside the Skin's registry (ADR 0006): the page's « Approuver » only emits a `cd-action` marked `sensitive: true`.

## Acceptance criteria

- [ ] On a GitHub Projet the page shows the PRD read from the (fake) GitHub at `verdictSha`; the server's request log shows no read of the file.
- [ ] « Approuver le PRD » opens the product's confirmation with « Confirmé par Crewdeck » and the consequences naming the next Étape of the pinned version; confirming merges PR #14 at that SHA, passes the gate with its output at the merge's head, resolves the Décision, and the engine starts the next Étape.
- [ ] On a Local Projet the same approval sends `merge.local` at that SHA and passes the gate on its answer; a refused merge leaves the gate « merge en attente » with SOURCE-5's Décision, and passes it once the retry succeeds.
- [ ] A push after the verdict makes the approval fail with `designs.head-moved` and the page asks to reload; a verdict not passed gives `designs.contract-not-passed`.
- [ ] « Demander des changements » writes one comment holding every remark in the remarks format (on GitHub, or in `local.db` for Local), gives the gate the Verdict « changements », and the Étape that wrote the PRD reruns (`iteration` 2); on a gate without a Retour the button is absent and the route answers `designs.no-loop-back`.
- [ ] A change merged outside Crewdeck (on GitHub, or by hand in the Local folder) passes the waiting gate as an approval would.
- [ ] Route baseline for `approve` and `request-changes`: nominal, 400, 401, 404 for another Pilote's Conception, 409 stale `seq` and during Resynchronisation, 422 for each rule.
- [ ] Playwright at 390 and 1280 px on both states, axe without violations.

## Verification

- `pnpm exec nx test server -- src/designs/approvals.spec.ts src/process/engine/kinds/approval.spec.ts`
- `pnpm exec nx test-integration server -- designs`
- `pnpm exec nx test skin-passerelle -- src/page-relecture.spec.ts`
- `pnpm exec nx e2e web -- relecture.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`
- `scripts/captures.sh relecture relecture-confirmation`.

## For prod

Nothing.

## Out of scope

- The mockups' review page: CONCEPTION-6. The Tickets' gate and page: CONCEPTION-10.
- Taking a Retour, its maximum and `loop-back.exhausted`: PROCESS-6. The local merge itself: SOURCE-5.
- Inline comments on lines of the change: not at the MVP (one comment).

## Dependencies

- CONCEPTION-3.
- CORE-7.
- SOURCE-5.
