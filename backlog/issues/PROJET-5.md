---
id: PROJET-5
title: "Approving or sending back the Inventaire: read at its SHA from GitHub or through the Runner, merged into the integration branch of the repository or the folder, or changes asked to the Session"
epic: PROJET
type: feature
priority: P1
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [PROJET-4, CORE-7, SESSION-2, SOURCE-4, SOURCE-5]
adr: [0002, 0003, 0006, 0012]
risques: []
stories: [US-68, US-26]
screens: [projet-inventaire-a-approuver, projet-inventaire-confirmation]
revue_visuelle: true
video: false
reprend: 109
---

## Context

US-68: the Décision asks the Pilote to approve the Inventaire at once or to send it back with their changes, what they approve being written to the Source of its documents (its folder, or its repository visibly on GitHub). US-26 and the glossary: approving the inventory of an existing code base is an **Action sensible**, confirmed in the product's own dialog. ADR 0002: on GitHub, approving merges `crewdeck/inventaire` into the integration branch through the merges API, one merge commit by the server, bound to the SHA the Pilote read; when a branch protection refuses, the same change goes as a PR. A Pilote's comment is free text: it never reaches the server in clear (ADR 0003), it goes to the Session through the encrypted relay.

The refonte (PRD #169, ADR 0012) adds the Local Projet: its documents are files of its folder, read by the page through the Runner (SOURCE-4's Local fetcher, `artifact.read` of kind `file` at the SHA), and approved the way a local change merges (SOURCE-5: squashed in the Runner's clone on the folder's integration head, then the folder fast-forwarded, a refusal raising `merge.local-blocked` and retried by the Runner). The page reads a GitHub Projet's files from GitHub with the user token through SOURCE-4's GitHub fetcher, so this ticket no longer builds its own reader of GitHub content.

## Current state of the code

- `apps/server/src/github/github.client.ts`: `mergeBranch(repo, { base, headSha, message })`, `createPullRequest`, `getBranch`; `github.errors.ts` (`github.branch-protected`); `webhooks/dispatcher.ts` (`GitHubEvents.on`). `@SensitiveAction`, `withSeq`, `SensitiveActionsService.assertFresh` (CORE-7); `apps/web/src/dialogs/confirm.ts` (`confirmSensitiveAction`); `SENSITIVE_ACTION_IDS` has `inventory.approve`.
- Skin: `Banner`, `Card`, `Button`, `Dialog`, `TextField`, `ProcessTrack` exist in `packages/skin-passerelle/src/`; no Composant renders a document.
- Created by PROJET-4: the « Préparation » PhaseRun and its `inventory` StepRun, `inventoryState` (`drafting`, `to-approve`), `inventoryHeadSha`, `inventoryFigures`, the `inventory-review` Décision, `InventoryService.startFor`, the Skill that applies the Pilote's first message on a send-back.
- Created by PROJET-3: `PageProjet`'s readiness Card, `ReadinessService.recompute`. By PROJET-6: `PageProjet` (header, « Projet » Card), `projectName(project)`.
- Created by SOURCE-4: `apps/web/src/documents/reader.ts` (`documentQuery({ projectId, source, kind: 'file', ref: { path, at } })`, the GitHub and Local fetchers, `{ state: 'ready' | 'unavailable' }`), `artifact.read` of `file` on the Runner (`git show <at>:<path>` in the clone).
- Created by SOURCE-5: `merge.local { projectId, changeNumber, sha }` and `merge.local.result { …, outcome: 'merged'|'conflict'|'blocked'|'stale', mergeSha? }`, `apps/runner/internal/source/local/merge.go`, `LocalMerges.request`, the hook `local-merge.finished(result)`, the Décision `merge.local-blocked`.
- Created by SESSION-1/SESSION-2: `sendInput`, `openSessionPanel`.

## To do

- **Composant** `DocumentReader` (`packages/contracts/src/composants/document-reader.ts`, `packages/skin-passerelle/src/document-reader.ts`, registered in `COMPOSANTS` and `/parametres/composants`): data `{ title, markdown, state: 'ready' | 'loading' | 'unavailable', reason: string | null }`, the markdown rendered with `marked` and sanitised with `dompurify` inside its shadow root; action `close`. The first screen that shows a document; CONCEPTION-4 and BOUCLE-6 reuse it.
- **Page** `/projets/:id` for a Projet with code whose Inventaire is not approved (`apps/web/src/views/projet.ts`):
  - header count « inventaire à approuver », actions « Demander des changements » and the primary « Approuver l'inventaire » (action `sensitive: true`, `inventory.approve`);
  - the accent `Banner` « Ce Projet a déjà du code » with the mockup's sentence;
  - three Cards from `inventoryFigures`: « Glossaire » (« <n> termes »), « Choix techniques » (<n>), « Inventaire » (« <apps> apps · <screens> écrans »), each with its sentence and « Relire », which opens the `DocumentReader` under it with `CONTEXT.md`, the ADRs the Inventaire added (the links of `docs/inventory.md`'s opening list, PROJET-4, each read as its own file), newest number first, or `docs/inventory.md`, all at `inventoryHeadSha`, through `documentQuery` with the `code` group's Source; `unavailable` (the Runner offline for Local) shows « Le Runner est hors ligne : le contenu revient avec lui. »;
  - the Card « Préparation »: `ProcessTrack` « Projet préparé » (done when PROJET-3's checks other than `inventory` are `ok`), « Inventaire à approuver » (current, « rédigé il y a <durée> »), « Process prêt » (todo);
  - `drafting`: the two buttons disabled, the step's meta « en cours de rédaction » and « Ouvrir la session » (`openSessionPanel`); `awaiting-merge`: a caution `Banner`, on GitHub « Branche protégée : merge la PR #<n> sur GitHub » with its link, on Local « Merge en attente : tes modifications touchent les mêmes fichiers » (SOURCE-5's Décision says which); `approved`: the cards are replaced by PROJET-3's readiness only.
- **Approve** `POST /api/projects/:id/inventory/approve { headSha, seq }` (`@SensitiveAction('inventory.approve')`), after `confirmSensitiveAction` « Approuver l'inventaire de <Projet> ? », action « Approuver l'inventaire », consequences « Crewdeck va : écrire le glossaire, les choix techniques et l'inventaire dans <Projet> (sur GitHub, ou dans son dossier sur ta machine) ; démarrer le Process pour ce Projet : ses Idées, Conceptions et Tickets suivent ensuite le Process. »:
  - 404 `project.not-found`; 422 `inventory.not-to-approve` « Rien à approuver pour ce Projet. » when the state is not `to-approve`; 409 `inventory.stale` « L'inventaire a changé depuis ta lecture : relis-le. » when `headSha` is not `inventoryHeadSha`; 422 `inventory.integration-branch-missing` « Crée d'abord la branche d'intégration (« Corriger » sur la page du Projet). » (PROJET-3's `branches` or `folder` check not `ok`); the stale `seq` of CORE-7; French messages in `apps/server/src/errors/messages.ts`;
  - the `code` group on GitHub: `mergeBranch(repo, { base: integrationBranch, headSha, message: 'chore(crewdeck) : inventaire approuvé' })` → `inventoryState: 'approved'`, `resolve('inventory-review', projectId, 'approved')`, `ReadinessService.recompute`; `github.branch-protected` → `createPullRequest(head 'crewdeck/inventaire', base integrationBranch, title « Inventaire de <Projet> »)`, `inventoryState: 'awaiting-merge'`, `inventoryPrNumber` stored, the Décision kept open with `params.prNumber`;
  - the `code` group Local: `LocalMerges.request` with the branch form this ticket adds to SOURCE-5's protocol, `merge.local { projectId, branch: 'crewdeck/inventaire', sha: headSha, title: 'docs(crewdeck) : inventaire approuvé' }` (`changeNumber` and `branch`: exactly one; the branch form squashes like a change, with that title, and records no change); `inventoryState: 'awaiting-merge'` until `local-merge.finished`: `merged` → `approved`, resolved, recomputed; `blocked` → stays `awaiting-merge` (SOURCE-5's Décision and retry); `stale` or `conflict` → back to `to-approve`, the Décision's `params.mergeOutcome` set and its view's context « L'inventaire a changé depuis ta lecture : relis-le. » or « L'inventaire ne s'applique plus sur la branche d'intégration : demande des changements. »; 422 `runner.offline` when the Runner is offline.
- **GitHub events** (`GitHubEvents.on`): `pull_request.closed` merged whose number is `inventoryPrNumber` → `approved` and resolved; `push` to `crewdeck/inventaire` whose `after` is not `inventoryHeadSha` while `to-approve` → back to `drafting` and the Décision resolved with `voided` (a new verdict raises it again, PROJET-4).
- **Send back** « Demander des changements »: a `Dialog` with a multiline `TextField` « Ce que tu veux changer », « Renvoyer »; the page calls `POST /api/projects/:id/inventory/send-back { seq }` (422 `inventory.not-to-approve`, 422 `runner.offline`), which calls `InventoryService.startFor` again (a new « Préparation » PhaseRun, its Session on `crewdeck/inventaire` based on the branch itself), sets `drafting`, resolves the Décision with `changes-requested` and returns `{ sessionId }`; the page then sends the comment as an encrypted `message` input to that Session (`sendInput`) as soon as it is `active`, and keeps it in memory until then (never stored).
- Prisma: `projects.inventory_pr_number`.
- t() keys `projet.inventory.*` in `packages/sdk/src/i18n/fr.ts`.
- Scenarios `apps/server/src/testing/scenarios/projet.ts` gain `projet-inventaire-a-approuver` and `projet-inventaire-confirmation` (FakeGitHub serves the three files at the head SHA); a Local variant seeded through the fake Runner's `artifact.read`; Playwright `apps/web/e2e/projet-inventaire.spec.ts`.

## Decisions already made

- Mockup: `projet-inventaire-a-approuver`, `projet-inventaire-confirmation` (pages `design/screens/crewdeck/projet-inventaire-a-approuver.html`, `…/projet-inventaire-confirmation.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The « Projet préparé » step's meta « labels, branches, .process.json » is filler: no `.process.json` (ADR 0011).
- The SHA the Pilote read is the one the page fetched the files at (`inventoryHeadSha` from the store); the merge uses that SHA, so nothing pushed after the reading can enter, on GitHub (`headSha` of the merge) as in the folder (SOURCE-5's `stale`).
- On GitHub, approving writes straight to the integration branch, never a PR to merge, except when a protection refuses (ADR 0002). On Local, it is a squash on the folder's integration branch with the Pilote's identity, their working tree touched only by `merge --ff-only` (SOURCE-5).
- The branch form of `merge.local` is added here rather than a local change record for the Inventaire: the Inventaire is not a change of code to review, and its Skill opens none on either Source.
- The comment of a send-back goes only through the relay; the server knows that changes were asked, never what.

## Acceptance criteria

- [ ] A GitHub Projet `to-approve` shows the three cards with their counts; « Relire » shows each file read from GitHub at the head SHA.
- [ ] A Local Projet `to-approve` shows the same files read through the Runner at the head SHA; the Runner offline shows the cards with « Le Runner est hors ligne ».
- [ ] « Approuver l'inventaire » opens the product's confirmation (« Confirmé par Crewdeck »); confirming on GitHub merges `crewdeck/inventaire` at that SHA into the integration branch (FakeGitHub records `mergeBranch` with that `headSha`), the Projet becomes `approved`, the Décision leaves « À toi », and the readiness row turns « ok ».
- [ ] Confirming on Local sends `merge.local` with the branch and the SHA; `merged` makes the Projet `approved` (Go test: `develop` in a temporary folder points to the squash commit `docs(crewdeck) : inventaire approuvé`); `blocked` keeps it `awaiting-merge`; `stale` brings it back to `to-approve` with its context.
- [ ] A push to `crewdeck/inventaire` on GitHub after the reading makes the approval fail with 409 `inventory.stale`, and the Projet goes back to `drafting`.
- [ ] A protected integration branch on GitHub opens the PR « Inventaire de <Projet> »; its merge on GitHub makes the Projet `approved`.
- [ ] « Demander des changements » starts a new Session on the branch and the comment reaches it through the relay; the server's request carries no comment (test on the request body and the stored rows).
- [ ] The routes follow the baseline: 401, 404 for another Pilote's Projet, 409 stale `seq` and during a Resynchronisation, 422 for each rule above.
- [ ] Screens at 390 and 1280 match the mockups, axe without violations.

## Verification

- `pnpm exec nx test server -- src/projects/inventory/`
- `pnpm exec nx test-integration server -- inventory`
- `pnpm exec nx test web -- src/views/projet.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/document-reader.spec.ts`
- `pnpm exec nx test contracts -- src/runner/`
- `cd apps/runner && go test ./internal/source/local/ -run 'Merge'`
- `pnpm exec nx e2e web -- projet-inventaire.spec.ts`; `scripts/captures.sh projet-inventaire-a-approuver projet-inventaire-confirmation` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

A migration (`projects.inventory_pr_number`), run by the deploy.

## Out of scope

- Drafting the Inventaire and its Contrat: PROJET-4. The other checks of the Projet: PROJET-3.
- The document reader's fetchers and `artifact.read`: SOURCE-4. A local change's merge and `merge.local-blocked`: SOURCE-5.

## Dependencies

- PROJET-4
- CORE-7
- SESSION-2
- SOURCE-4
- SOURCE-5
