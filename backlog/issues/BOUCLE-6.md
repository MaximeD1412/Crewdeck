---
id: BOUCLE-6
title: "Visual review of a Ticket: captures against the mockups, approve and merge, or ask for changes"
epic: BOUCLE
type: feature
priority: P1
size: M
milestone: M4 Boucle
blocked_by: [BOUCLE-4, CORE-7, PARAM-4]
adr: [0002, 0003, 0006, 0009]
risques: []
stories: [US-36, US-26, US-83]
screens: [revue-visuelle, revue-visuelle-confirmation-merge, revue-visuelle-changements]
revue_visuelle: true
video: false
---

## Context

US-36: the Pilote reviews the captures of a **Ticket** that has screens and either approves it, which merges its PR, or asks for changes with a comment the **Boucle** takes up, while the Boucle goes on with the Tickets that do not depend on it. The **Revue visuelle** is the Pilote's gate (glossary), an **Étape optionnelle** a Projet may turn off (US-83). The merge is an **Action sensible** confirmed by the core (US-26), bound to the commit whose captures the Pilote saw (ADR 0002). Captures are pushed by the Runner to the orphan branch `captures/<n>` and read by the browser from GitHub (ADR 0003).

## Current state of the code

- No code in the repository: only the docs and `design/`.
- Created by BOUCLE-4: `merge-gate.ts` with the hook `requiresVisualReview(ticket)` returning false, `LoopMerger.merge(ticket, sha)`.
- Created by BOUCLE-3: `visualReview` in the Code StepRun's input, the Contrat rule `code.pr.captures`, the Code Skill's « Modes » (`visual-fix` empty).
- Created by BOUCLE-5: `apps/web/src/github/comments.ts` (post a comment with the user token), the Ticket's page.
- Created by CORE-7: `@SensitiveAction('merge')`, `crewdeck-confirm`. Created by PARAM-4: the Étape optionnelle `visual-review` in `SettingsService.effective(...).optionalSteps`.
- Created by UI-6: `Capture`, `CheckRow`; UI-2, UI-4: `Tabs`, `Chip`, `Dialog`, `Select`, `TextField`.
- Created by ATOI-1: `DecisionsService`; the « À toi » row « Revue visuelle ».
- Source: the founder's `agent-loop` « Visual review » (dotfiles repository `MaximeD1412/dotfiles`, `agents/tools/agent-loop/README.md`, `prompts/fix-visual-review.md`).

## To do

- Skill `code`, for `visualReview`: capture each screen the Ticket changes at 390 × 844 and 1280 × 800 with the Projet's capture command named in its conventions file (Crewdeck's `scripts/captures.sh`), push them to the orphan branch `captures/<n>`, write `.crewdeck/captures.json` (`[{ screen, state?, width, path, mockup? }]`, `mockup` the capture path of that screen in the Projet's `design/screens.json` when it has one) and report it; mode `visual-fix` from `fix-visual-review.md` (read the Pilote's comment after the last `<!-- crewdeck:visual-changes -->`, fix, reply, push, refresh the captures).
- Runner: the report carries `{ captures: [...paths...], capturesCommit, headSha }` (paths and SHAs are metadata).
- Prisma on `Ticket`: `capturesHeadSha?`, `capturesCommit?`, `captures` (JSON array of `{ screen, state?, width, path, mockup? }`).
- `requiresVisualReview(ticket)`: the label `revue-visuelle` and `optionalSteps['visual-review']` on for the Projet. When the gate would merge such a Ticket and `capturesHeadSha` is the head: `loopStep: visual-review`, a PR comment « En attente de revue visuelle » (server, product text), `visual-review` raised (label « #<n> <titre> » (the kind « Revue visuelle » is rendered by ATOI-1), meta « <Projet> · <k> captures »); the Boucle takes its next Ticket. Captures of another SHA → back to a Code StepRun refreshing them.
- `apps/server/src/loops/visual-review.controller.ts`:
  - `POST /api/projects/:id/tickets/:number/visual-review/approve` `{ seq, sha }`, `@SensitiveAction('merge')`: `sha` must equal `capturesHeadSha` and the head, else 409 `visual-review.stale`; the Ticket must be `visual-review` (else 422 `visual-review.not-waiting`); merges through `LoopMerger.merge(ticket, sha)` even if the Boucle is stopped (the Pilote confirmed this merge); resolves the Décision (`outcome: approved`).
  - `POST /api/projects/:id/tickets/:number/visual-review/request-changes` `{ seq, commentId }`: resolves the Décision (`outcome: changes`), `LoopRecord.pilotIntervened: true`, queues the Ticket first with a Code StepRun `mode: visual-fix`; after it, Review and checks run again, then the visual review comes back.
  - 404 `ticket.not-found`, 401, 400 with `fields`.
- Web:
  - Router `/projets/:id/tickets/:number/revue-visuelle`; `apps/web/src/views/revue-visuelle.ts`; Composant `PageRevueVisuelle` (`packages/contracts/src/composants/page-revue-visuelle.ts`, `packages/skin-passerelle/src/page-revue-visuelle.ts`), actions `approve` (`sensitive: true`), `requestChanges` (`{ screen?, text }`), `openOnGitHub`.
  - Header « #<n> <titre> », « <Projet> · revue visuelle », « Demander des changements » and « Approuver et merger » (also repeated at the foot); Banner « La Boucle continue sans toi » « Pendant ta revue, la Boucle avance sur les Tickets de <Projet> qui ne dépendent pas de #<n>. ».
  - Tabs per screen of `captures`; « Avant toi » (CheckRow Checks « 4 sur 4 », Review « <Moteur> · aucune remarque »); « Pull request » (PR, Branche, Captures « 2 écrans · 4 captures », « Voir sur GitHub »).
  - At 390: tabs « Maquette » / « Livré » and chips 390 / 1280 over one `Capture`; at 1280: cards « Téléphone · 390 » and « PC · 1280 », each the mockup beside the delivered capture. Images read by the browser from GitHub (`captures/<n>` at `capturesCommit`, the mockup at the PR's head) through `@tanstack/query-core`; a screen without mockup shows the delivered capture alone.
  - Approve: `crewdeck-confirm` « Merger la PR de #<n> ? », action « Approuver et merger », consequences « Tu approuves la revue visuelle de #<n> <titre> (<Projet>). La PR #<pr> est mergée dans <branche>. Les Tickets qui dépendent de #<n> deviennent prêts et la Boucle les prend. ».
  - Changes: `Dialog` « Demander des changements »: « Ton commentaire part à la Boucle : l'agent de Code reprend #<n> avec lui, puis la revue visuelle te revient. », Select « Écran concerné (facultatif) », TextField « Ce qu'il faut changer », « Annuler », « Envoyer à la Boucle »: the browser posts the PR comment (`<!-- crewdeck:visual-changes -->`, the screen, the text) then calls `request-changes`.
  - The « À toi » `visual-review` row opens this page (« Relire »).
- Test scenarios `apps/server/src/testing/scenarios/revue-visuelle.ts`, the fake GitHub serving the capture images, Playwright `apps/web/e2e/revue-visuelle.spec.ts`.

## Decisions already made

- Mockup: `revue-visuelle`, `revue-visuelle-confirmation-merge`, `revue-visuelle-changements` (pages `design/screens/crewdeck/revue-visuelle.html`, `…/revue-visuelle-confirmation-merge.html`, `…/revue-visuelle-changements.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The dictation icon of the comment field is IDEE-4's, not built here.
- Only Crewdeck's approval counts at the MVP; a GitHub « Approve » review is ignored, a merge on GitHub by the Pilote is read back by BOUCLE-1.
- With the Étape optionnelle off, a Ticket labelled `revue-visuelle` is merged by the gate like any other, and its Code Contrat does not require captures.
- The server never reads the images nor the comment: paths, SHAs and the comment id only.

## Acceptance criteria

- [ ] A Ticket labelled `revue-visuelle` whose review and checks passed on SHA `a1…`, with captures of `a1…`, stops in `visual-review`, raises « Revue visuelle · #38 Page Planning » and the Boucle takes a ready Ticket that does not depend on #38.
- [ ] Approving after the core's confirmation merges with `sha: a1…`; if the head moved, 409 `visual-review.stale` and nothing is merged.
- [ ] Asking for changes posts the PR comment, resolves the Décision, and the next Code StepRun of the Ticket is `visual-fix`; the visual review comes back after review and checks.
- [ ] With `visual-review` off for the Projet, the same Ticket is merged by the gate without a visual review.
- [ ] Routes: 422 `visual-review.not-waiting`, 409 stale `seq`, 404 for another Pilote's Ticket, 401, 400 with `fields`.
- [ ] The page matches the three mockups at 390 and 1280 px (Playwright against the fake Runner and the fake GitHub, axe without violations); the captures come from those tests.

## Verification

- `pnpm exec nx test server -- src/loops/visual-review.spec.ts`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- loops`
- `pnpm exec nx test skin-passerelle -- src/page-revue-visuelle.spec.ts`
- `pnpm exec nx e2e web -- revue-visuelle.spec.ts`
- `scripts/captures.sh apps/web/e2e/revue-visuelle.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

A migration (columns `tickets.captures_head_sha`, `captures_commit`, `captures`). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- An automatic visual audit before the review: US-72 (Bêta).
- The ticket's page and blocked Tickets: BOUCLE-5. Dictation: IDEE-4.

## Dependencies

- BOUCLE-4
- CORE-7
- PARAM-4
