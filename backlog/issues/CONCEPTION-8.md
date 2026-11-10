---
id: CONCEPTION-8
title: "Revue croisée Étape: a second agent reads the PRD and the technical design before the Pilote approves them"
epic: CONCEPTION
type: feature
priority: P2
size: M
milestone: M6 Conception
blocked_by: [CONCEPTION-4]
adr: [0004, 0005]
risques: [IA-6]
stories: [US-10, US-48, US-83]
screens: []
revue_visuelle: false
video: false
---

## Context

The **Revue croisée** (glossary): an agent in the Rôle Review reads the PRD, then the technical design, of a Conception, just before the Pilote approves each; every remark is fixed or answered « non retenue ». It is an Étape optionnelle (US-83), shown as such on the Conception (US-10), checked against its Contrat (ADR 0005's row: « every remark answered, fixed or « non retenue » with a reason »). The rules are the dotfiles' (`MaximeD1412/dotfiles`, `agents/skills/product-design/REFERENCE.md` « Revue croisée »), where the author's session settles the remarks of Codex and publishes them in one PR comment.

## Current state of the code

- Created by CONCEPTION-1: the `cross-review-prd` and `cross-review-technical` `DesignStep`s, `nextStep(...)` (a cross review is skipped when `cross-review` is off).
- Created by CONCEPTION-3: `documents.ts` with `documentReady(tx, design, kind)` raising `document-review`, the voided-verdict re-check on a push.
- Created by CONCEPTION-4: the approval refusing while the cross review runs (`designs.cross-review-pending`), the « Revue croisée » `CheckRow` of the review page.
- Created by CONCEPTION-3 / CONCEPTION-7: the `product-design` and `technical-design` Skills without their own cross review.
- Created by PARAM-2: the Rôle `review`'s Moteur (on another Moteur than the Code by default).
- No `cross-review` Étape.

## To do

- **Server** (`apps/server/src/designs/cross-review.ts`):
  - `documentReady` for `prd` and `technical-design`: when `cross-review` is on for the Projet and this document's cross review has not run (`todo`), start the `cross-review` `StepRun` (step `cross-review`, `subjectType: 'design'`, arguments `{ document: 'prd' | 'technical-design', prNumber, reviewer: roles.review, author: roles.design }`) and mark the cross review `DesignStep` `running` **instead of** raising `document-review`. Otherwise (off, settled, failed) raise it as before.
  - On the cross review's `passed` verdict: its `DesignStep` `approved` (« réglée ») with `figures.remarks` and `figures.nonRetenues`; then `documentReady` again (raises the Décision once the document is `ready` at the head; the settling push goes through CONCEPTION-3's re-check first).
  - On `failed` (a Moteur's limit, a timeout): the cross review `failed`, the document's Décision raised with the context « Revue croisée échouée : <reason> » (ATOI-2's « Étape échouée » offers « Relancer l'Étape »); the approval is not blocked by a failed cross review, only by a running one.
- **Runner** `apps/runner/internal/steps/crossreview/`: one Étape, two Sessions in sequence on a worktree of the PR's branch, both linked to the `StepRun`:
  1. the reviewer, Rôle `review` with its Moteur, Skill `apps/runner/skills/cross-review/SKILL.md`: reads the document (and, for a technical design, the PRD and `CONTEXT.md`), writes `.crewdeck/cross-review.json` `remarks` (each `id` `R1`…, `severity` high|medium|low, `file`, `anchor`, `quote`, `text` in French);
  2. the author, Rôle `design` with its Moteur, Skill `apps/runner/skills/cross-review-settle/SKILL.md` (the dotfiles rules word for word: `corrigee` or `non-retenue`, never silently dropped, a `high` remark non retenue only with a checkable reason): fills `answers`, commits the fixes as one commit `docs(product) : revue croisée réglée` (`docs(design) : …` for a technical design), pushes, posts the remarks and answers as one PR comment with the Session's token (`crewdeck-runner etape comment --pr <n> --file <markdown>`, `apps/runner/internal/github/comments.go`), then `crewdeck-runner etape report` with `{ headSha, remarks, nonRetenues }`.
  - With zero remarks, the author's Session is not started and the comment says « Revue croisée : aucune remarque ».
  - `.crewdeck/cross-review.json` stays on the Runner (never sent to the server).
- **Contrat** `packages/contracts/src/contrats/cross-review.ts`, version 1:
  - `cross-review.remarks.schema` (`json` `.crewdeck/cross-review.json` against `zCrossReviewFile` in `packages/contracts/src/design/cross-review.ts`), « Les remarques de la revue croisée sont lisibles »;
  - `cross-review.answers.complete` (`check` `cross-review-answers`, `checks/cross_review_answers.go`): one answer per remark, no unknown id, `outcome` in `corrigee | non-retenue`, a non-empty `answer`, « Chaque remarque est corrigée ou non retenue avec sa raison »;
  - `cross-review.comment` (`check` `cross-review-comment`): the PR has the comment posted by this Étape (its id in the report), « Les remarques et leurs réponses sont sur la PR ».
  - Fixtures passing and failing per rule.
- **Web**: the review page's « Revue croisée » `CheckRow` (CONCEPTION-4) shows « <reviewer's Moteur> · réglée », « N non retenues », « en cours », « échouée : <reason> » or « désactivée »; the Conception's track (CONCEPTION-2) gets the cross review's meta « revue croisée réglée par <Moteur> ».

## Decisions already made

- The Revue croisée is one Étape with one Contrat, run by two agents: the reviewer (Rôle Review, independent) and the author (Rôle Conception, who knows the decisions of the rounds).
- It runs on the design PR, after the document's Contrat passed and before the Pilote's review (glossary: « just before the Pilote approves each »), not before the PR as in the dotfiles: the PR is how the server knows the document.
- A failed cross review never blocks the Pilote: they may approve with « Revue croisée échouée » shown, or rerun it.
- No cross review on the mockups nor the Tickets (the dotfiles' « What has none »).

## Acceptance criteria

- [ ] With `cross-review` on, a `ready` PRD starts the `cross-review` Étape instead of raising « Conception à relire »; once settled, the Décision is raised with « Revue croisée réglée » and the review page shows « <Moteur> · réglée ».
- [ ] A remark without answer, an answer `non-retenue` with an empty reason, or an answer to an unknown id fails `cross-review.answers.complete` (Go fixtures).
- [ ] The settling commit's push re-checks the PRD's Contrat (CONCEPTION-3) and the Décision is raised once, at the new head.
- [ ] With `cross-review` off, the Décision is raised at once and the track shows « désactivée pour ce Projet ».
- [ ] A reviewer's Moteur at its limit fails the Étape; the Décision is raised with « Revue croisée échouée : limite atteinte » and the approval is allowed.
- [ ] The cross review of the technical design runs the same way after its report.

## Verification

- `cd apps/runner && go test ./internal/contrat/... -run CrossReview && go test ./internal/steps/crossreview/`
- `pnpm exec nx test server -- src/designs/cross-review.spec.ts`
- `pnpm exec nx test-integration server -- designs`
- `pnpm exec nx run contracts:generate` with no diff; `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- A cross review of a Ticket's PR: that is the Review Étape (BOUCLE-4).
- Catching up a cross review on an already approved document (the dotfiles' `--cross-review`): not at the MVP.

## Dependencies

- CONCEPTION-4.
