---
id: PROJET-5
title: "Approving or sending back the Inventaire: read from GitHub at its SHA, merged into the integration branch, or changes asked to the Session"
epic: PROJET
type: feature
priority: P1
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [PROJET-4, CORE-7, SESSION-2]
adr: [0002, 0003, 0006]
risques: []
stories: [US-68, US-26]
screens: [projet-inventaire-a-approuver, projet-inventaire-confirmation]
revue_visuelle: true
video: false
---

## Context

US-68: the Décision asks the Pilote to approve the Inventaire at once or to send it back with their changes, what they approve being written to the repository visibly on GitHub. US-26 and the glossary: approving the inventory of an existing repository is an **Action sensible**, confirmed in the product's own dialog. ADR 0002: the browser reads the files from GitHub; approving merges `crewdeck/inventaire` into the integration branch through the merges API, one merge commit by the server, bound to the SHA the Pilote read; when a branch protection refuses, the same change goes as a PR and the Décision says so. A Pilote's comment is free text: it never reaches the server in clear (ADR 0003), it goes to the Session through the encrypted relay.

## Current state of the code

- Only documents: the mockups `design/screens/crewdeck/projet-inventaire-a-approuver.html`, `projet-inventaire-confirmation.html`.
- Created by PROJET-4: the `inventory` StepRun, `inventoryState` (`drafting`, `to-approve`), `inventoryHeadSha`, `inventoryFigures`, the `inventory-review` Décision, `InventoryService`, the Skill that applies the Pilote's first message on a send-back.
- Created by PROJET-3: `/projets/:id` (`PageProjet`, `apps/web/src/views/projet.ts`), `ReadinessService.recompute`. PROJET-1: `GitHubEvents` (`push`, `pull_request`).
- Created by CORE-3: `GitHubClient.mergeBranch(repo, { base, headSha, message })`, `createPullRequest`, `getBranch`, `github.branch-protected`; `FakeGitHub` serving `/fake-github/repos/:owner/:repo/contents/*path?ref=`. CORE-4: `POST /api/github/token`. CORE-7: `@SensitiveAction`, `crewdeck-confirm`, `sensitive: true` actions.
- Created by SESSION-1/SESSION-2: `sendInput`, `openSessionPanel`. RUNNER-12: `StepsService.start`.
- Created by UI-2: `Banner`, `Card`, `Button`; UI-4: `Dialog`, `TextField`; RUNNER-3 or UI-6: `ProcessTrack`.

## To do

- **Reading GitHub from the page** `apps/web/src/github/content.ts` (on `@tanstack/query-core`, keyed by repository, path and commit; the token from `POST /api/github/token`, the base URL from `GET /api/config`): `readFile(repo, path, sha) → string`, `listDir(repo, path, sha) → { name, path }[]`. Reused later by every page that reads content (CONCEPTION-4, BOUCLE-6).
- **Composant** `DocumentReader` (`packages/contracts/src/composants/document-reader.ts`, `packages/skin-passerelle/src/document-reader.ts`): data `{ title, markdown }`, rendered with `marked` and sanitised with `dompurify` inside its shadow root; action `close`.
- **Page** `/projets/:id` for a Projet with code whose Inventaire is not approved (`apps/web/src/views/projet.ts`):
  - header count « inventaire à approuver », actions « Demander des changements » and the primary « Approuver l'inventaire » (action `sensitive: true`, `inventory.approve`);
  - the accent `Banner` « Ce Projet a déjà du code » with the mockup's sentence;
  - three Cards from `inventoryFigures`: « Glossaire » (« <n> termes »), « Choix techniques » (<n>), « Inventaire » (« <apps> apps · <screens> écrans »), each with its sentence and « Relire », which opens the `DocumentReader` under it with `CONTEXT.md`, the ADRs of `docs/adr/` added since the release branch (`listDir` then `readFile`, newest number first), or `docs/inventory.md`, all at `inventoryHeadSha`;
  - the Card « Préparation »: `ProcessTrack` « Projet préparé » (done when PROJET-3's labels, branches and `process-json` checks are `ok`), « Inventaire à approuver » (current, « rédigé il y a <durée> »), « Process prêt » (todo);
  - `drafting`: the two buttons disabled, the step's meta « en cours de rédaction » and « Ouvrir la session » (`openSessionPanel`); `awaiting-merge`: a caution `Banner` « Branche protégée : merge la PR #<n> sur GitHub » with its link; `approved`: the cards are replaced by PROJET-3's readiness only.
- **Approve** `POST /api/projects/:id/inventory/approve { headSha, seq }` (`@SensitiveAction('inventory.approve')`), after `crewdeck-confirm` « Approuver l'inventaire de <Projet> ? », action « Approuver l'inventaire », consequences « Crewdeck va : écrire le glossaire, les choix techniques et l'inventaire dans <Projet>, sur GitHub ; démarrer le Process pour ce Projet : ses Idées, Conceptions et Tickets suivent ensuite le Process. »:
  - 404 `project.not-found`; 422 `inventory.not-to-approve` « Rien à approuver pour ce Projet. » when the state is not `to-approve`; 409 `inventory.stale` « L'inventaire a changé depuis ta lecture : relis-le. » when `headSha` is not `inventoryHeadSha`; 422 `inventory.integration-branch-missing` « Crée d'abord la branche d'intégration (« Corriger » sur la page du Projet). »; the stale `seq` of CORE-7;
  - `mergeBranch(repo, { base: integrationBranch, headSha, message: 'chore(crewdeck) : inventaire approuvé' })` → `inventoryState: 'approved'`, `resolve('inventory-review', projectId, 'approved')`, `ReadinessService.recompute`;
  - `github.branch-protected` → `createPullRequest(head 'crewdeck/inventaire', base integrationBranch, title « Inventaire de <Projet> »)`, `inventoryState: 'awaiting-merge'`, `inventoryPrNumber` stored, the Décision kept open with `params.prNumber` (its view's context: « Branche protégée : merge la PR #<n> sur GitHub. »).
- **GitHub events** (`GitHubEvents.on`): `pull_request.closed` merged whose number is `inventoryPrNumber` → `approved` and resolved; `push` to `crewdeck/inventaire` whose `after` is not `inventoryHeadSha` while `to-approve` → back to `drafting` and the Décision resolved with `voided` (a new verdict raises it again, PROJET-4).
- **Send back** « Demander des changements »: a `Dialog` with a multiline `TextField` « Ce que tu veux changer », « Renvoyer »; the page calls `POST /api/projects/:id/inventory/send-back { seq }` (422 `inventory.not-to-approve`, 422 `runner.offline` from `RunnerCommands`), which starts a new `inventory` StepRun on `crewdeck/inventaire` (base the branch itself), sets `drafting`, resolves the Décision with `changes-requested` and returns `{ sessionId }`; the page then sends the comment as an encrypted `message` input to that Session (`sendInput`) as soon as it is `active`, and keeps it in memory until then (never stored).
- Prisma: `projects.inventory_pr_number`.
- t() keys `projet.inventory.*`.
- Scenarios `apps/server/src/testing/scenarios/projet.ts` gain `projet-inventaire-a-approuver` and `projet-inventaire-confirmation` (FakeGitHub serves the three files at the head SHA); Playwright `apps/web/e2e/projet-inventaire.spec.ts`.

## Decisions already made

- Mockup: `projet-inventaire-a-approuver`, `projet-inventaire-confirmation` (pages `design/screens/crewdeck/projet-inventaire-a-approuver.html`, `…/projet-inventaire-confirmation.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The SHA the Pilote read is the one the page fetched the files at (`inventoryHeadSha` from the store); the merge uses that SHA as `head`, so nothing pushed after the reading can enter.
- Approving writes straight to the integration branch, never a PR to merge, except when a protection refuses (ADR 0002).
- The comment of a send-back goes only through the relay; the server knows that changes were asked, never what.

## Acceptance criteria

- [ ] A Projet `to-approve` shows the three cards with their counts; « Relire » shows each file read from GitHub at the head SHA.
- [ ] « Approuver l'inventaire » opens the product's confirmation (« Confirmé par Crewdeck »); confirming merges `crewdeck/inventaire` at that SHA into the integration branch (FakeGitHub records `mergeBranch` with that `headSha`), the Projet becomes `approved`, the Décision leaves « À toi », and the readiness row turns « ok ».
- [ ] A push to `crewdeck/inventaire` after the reading makes the approval fail with 409 `inventory.stale`, and the Projet goes back to `drafting`.
- [ ] A protected integration branch opens the PR « Inventaire de <Projet> »; its merge on GitHub makes the Projet `approved`.
- [ ] « Demander des changements » starts a new Session on the branch and the comment reaches it through the relay; the server's request carries no comment (test on the request body and the stored rows).
- [ ] The routes follow the baseline: 401, 404 for another Pilote's Projet, 409 stale `seq` and during a Resynchronisation, 422 for each rule above.
- [ ] Screens at 390 and 1280 match the mockups, axe without violations.

## Verification

- `pnpm exec nx test server -- src/projects/inventory/inventory.controller.spec.ts`
- `pnpm exec nx test-integration server -- inventory`
- `pnpm exec nx test web -- src/views/projet.spec.ts src/github/content.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/document-reader.spec.ts`
- `pnpm exec nx e2e web -- projet-inventaire.spec.ts`; `scripts/captures.sh apps/web/e2e/projet-inventaire.spec.ts` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

A migration (`projects.inventory_pr_number`), run by the deploy.

## Out of scope

- Drafting the Inventaire and its Contrat: PROJET-4. The other checks of the Projet: PROJET-3.

## Dependencies

- PROJET-4
- CORE-7
- SESSION-2
