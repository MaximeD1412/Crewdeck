---
id: CONCEPTION-4
title: "Reviewing a document of a Conception: approve it (merge bound to the SHA) or ask for changes"
epic: CONCEPTION
type: feature
priority: P0
size: M
milestone: M6 Conception
blocked_by: [CONCEPTION-3, CORE-7]
adr: [0002, 0003, 0006, 0007, 0008]
risques: [SEC-5]
stories: [US-11, US-26]
screens: [relecture, relecture-confirmation]
revue_visuelle: true
video: false
---

## Context

US-11: the Pilote reviews a Conception document and either approves it or asks for changes, so that nothing is built they did not validate. ADR 0002: approving a document is merging its design PR after the product's confirmation (US-26, Action sensible `document.approve`), bound to the head SHA the Pilote read; « Demander des changements » posts their comment on the PR and starts the `--fix` Session. The document is read by the browser from GitHub, never by the server. This ticket builds the review page for the PRD and the technical design (`/conceptions/:id/relecture/:step`) and the approve and request-changes commands shared by every document (the mockups' page is CONCEPTION-6, the Tickets' CONCEPTION-10).

## Current state of the code

- Created by CONCEPTION-1 to CONCEPTION-3: `Design`, `DesignStep` (`ready`, `prNumber`, `headSha`, `verdictSha`), `nextStep(...)`, `documents.ts`, the `document-review` Décision, `designs/pull-requests.listener.ts`.
- Created by CORE-7: `@SensitiveAction('document.approve')` (`apps/server/src/sensitive-actions/`), `crewdeck-confirm` (`apps/web/src/dialogs/confirm.ts`).
- Created by CORE-3: `GitHubClient.mergePullRequest(repo, n, { sha, method })` (409 `github.head-moved`), `GET /api/config` (the page's GitHub URL), the fake GitHub's `/fake-github` routes; by CORE-4: `POST /api/github/token`.
- Created by UI-6 / UI-7: `CheckRow`, `Message`; by UI-4: `TextField`, `Dialog`.
- No review page.

## To do

- **Contracts** (`packages/contracts/src/api/designs.ts`): `zApproveDesignStepInput = { sha: string (40 hex), seq }`, `zRequestDesignChangesInput = { commentId: number, seq }`, both → `zDesign`.
- **Server** `apps/server/src/designs/review.ts`:
  - `POST /api/designs/:id/steps/:step/approve` (`step` in `prd | mockups | technical-design | split`), `@SensitiveAction('document.approve')`: the `DesignStep` is `ready` (422 `designs.not-ready`), `sha === verdictSha` and its `StepRun`'s verdict `passed` at that SHA (422 `designs.contract-not-passed`), the cross review of this document not `running` (422 `designs.cross-review-pending`; a failed or turned-off cross review does not block), then `mergePullRequest(repo, prNumber, { sha, method: 'squash' })` — a moved head is 409 `designs.head-moved` (« Le document a changé depuis ta relecture : relis-le à nouveau. »). On success: `approvedSha`, `approvedAt`, state `approved`, the Décision resolved (outcome `approved`), and the next Étape (`nextStep`) started with `StepsService.start` (Rôle `design`, or `review` for a cross review), or marked `skipped`; a `split` approval calls `onSplitApproved` (a no-op hook here, CONCEPTION-9 implements it). One transaction for the state; the merge is called before it and its result recorded.
  - `POST /api/designs/:id/steps/:step/request-changes`: the `DesignStep` is `ready` or `checking` (422 `designs.not-ready`); the browser already posted the comment (`commentId`); state `changes-requested`, the Décision resolved (outcome `changes`), and a new `StepRun` of the same Étape started with `{ fix: true, commentId }` as the Skill's arguments.
  - The design PR merged on GitHub by the Pilote (`pull_request` `closed` merged, in `pull-requests.listener.ts`): the same as an approval at the merge's head SHA (ADR 0002: a merge on GitHub is read back like any other change), including the next Étape.
- **Web**:
  - `/conceptions/:id/relecture/:step` for `prd` and `technical-design`: `apps/web/src/views/relecture.ts`, Composant `PageRelecture` (`packages/contracts/src/composants/page-relecture.ts`, skin implementation) with its `examples`.
  - The content: the PR's changed Markdown files at `headSha`, read by the browser from GitHub with the user token (`GET {githubApiUrl}/repos/:o/:r/pulls/:n/files`, then each file's contents at the SHA), through `@tanstack/query-core` keyed by repository + SHA + path; the PRD file first (the technical design: `AGENTS.md`, then `docs/adr/*`, then `CONTEXT.md`, then the rest), one tab per file when there are several. Rendered with `marked`, sanitized with `DOMPurify` through PROJET-5's `DocumentReader` Composant, the files read with PROJET-5's `apps/web/src/github/content.ts`, inside the Composant's shadow root. A head that moved while reading shows a `caution` `Banner` « Le document a changé : recharge pour relire la dernière version. ».
  - « Tes remarques »: selecting a passage and « Citer » puts « « <passage> » » in the remark field; each remark added is a `Message` (`from="pilote"`); the remarks live in the tab's memory only (lost on reload, said under the field: « Tes remarques partent sur la PR quand tu demandes des changements. »).
  - « Vérifications »: `CheckRow` « Contrat du PRD » (passed « rempli », failed with the count), and « Revue croisée » (« <Moteur> · réglée », « en cours », « désactivée ») from the cross review's `DesignStep`.
  - « Demander des changements »: posts **one** comment on the PR from the browser with the user token (`POST {githubApiUrl}/repos/:o/:r/issues/:n/comments`, body: each remark as « **Sur « <passage> »** » then its text, a general remark last), then calls `request-changes` with the comment's id; disabled without a remark. The fake GitHub controller gains the comments route.
  - « Approuver le PRD » / « Approuver la conception technique »: an Action sensible: the core opens `crewdeck-confirm` with the title « Approuver le PRD de « <title> » ? », the action label, and the consequences « Crewdeck va : merger la PR #n du PRD dans <integration branch> ; démarrer l'Étape <next> avec le Moteur du Rôle Conception (<Moteur>). Tu relis ensuite <the next document> depuis « À toi ». » (computed from `nextStep` and the effective Paramètres); disabled during the Resynchronisation with its reason.
  - Copy under `t('relecture.*')`.
- **Tests and scenarios**: `apps/server/src/testing/scenarios/relecture.ts` (`relecture`, `relecture-confirmation`) with the fake GitHub holding the PRD of the mockup at a SHA; `apps/web/e2e/relecture.spec.ts`.

## Decisions already made

- Mockup: `relecture`, `relecture-confirmation` (pages `design/screens/crewdeck/relecture.html`, `…/relecture-confirmation.html`; captures `design/screens/crewdeck/relecture-390.png`, `…-1280.png` and the same for the state). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The comment is posted by the browser, as the Pilote, never by the server (ADR 0003: the server does not carry what the Pilote writes); the server gets only its id.
- Squash merge, as every merge by the server (ADR 0002).
- The approval binds three things to one SHA: the Pilote's reading (`sha` sent), the Contrat verdict (`verdictSha`) and GitHub's merge (`sha` of the merge API).
- The confirmation is the core's, outside the Skin's registry (ADR 0006): the page's « Approuver » only emits a `cd-action` marked `sensitive: true`.

## Acceptance criteria

- [ ] The page shows the PRD read from the (fake) GitHub at the head SHA; the server's request log shows no read of the file.
- [ ] « Approuver le PRD » opens the product's confirmation with « Confirmé par Crewdeck » and the consequences naming the next Étape; confirming merges PR #14 with the head SHA, marks the PRD approved, resolves the Décision and starts the Maquettes Étape (or the Conception technique when mockups are off or the PRD has no screens).
- [ ] A push after the verdict makes the approval fail with `designs.head-moved` and the page asks to reload; a verdict not passed gives `designs.contract-not-passed`; a cross review still running gives `designs.cross-review-pending`.
- [ ] « Demander des changements » posts one comment holding every remark, then starts the `--fix` run with its id; the Étape shows « changements demandés ».
- [ ] A PR merged on GitHub directly starts the next Étape as an approval would.
- [ ] Route baseline for `approve` and `request-changes`: nominal, 400, 401, 404 for another Pilote's Conception, 409 stale `seq` and during Resynchronisation, 422 for each rule.
- [ ] Playwright at 390 and 1280 px on both states, axe without violations.

## Verification

- `pnpm exec nx test server -- src/designs/review.spec.ts`
- `pnpm exec nx test-integration server -- designs`
- `pnpm exec nx test skin-passerelle -- src/page-relecture.spec.ts`
- `pnpm exec nx e2e web -- relecture.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`
- `scripts/captures.sh` for `relecture`, `relecture-confirmation`.

## For prod

Nothing.

## Out of scope

- The mockups' review page: CONCEPTION-6. The Tickets' review page and their creation: CONCEPTION-10, CONCEPTION-9.
- Inline comments on lines of the PR: not at the MVP (one PR comment).

## Dependencies

- CONCEPTION-3.
- CORE-7.
