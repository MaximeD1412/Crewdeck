---
id: CONCEPTION-8
title: "Revue croisée Étape: the cross-review kind handler, a second agent judging a document before the Pilote, its Retour to the author"
epic: CONCEPTION
type: feature
priority: P2
size: M
milestone: M6 Conception
blocked_by: [CONCEPTION-4]
adr: [0004, 0005, 0011, 0012]
risques: [IA-6]
stories: [US-10, US-48]
screens: []
revue_visuelle: false
video: false
reprend: 93
---

## Context

The **Revue croisée** (glossary): an agent in the « Review » Rôle reads the PRD, then the technical design, of a Conception, just before the Pilote approves each; every remark is fixed or answered « non retenue ». The refonte (PRD #169, ADR 0011) removes the Étapes optionnelles (US-83 is removed): the Revue croisée runs because it is in the Projet's Process (« Revue croisée du PRD » and « Revue croisée de la conception » in « Process Crewdeck »), the Conception's page showing it among the Étapes its Process gives it (US-10), checked against its Contrat (US-48). It becomes the `cross-review` **kind handler** of PROCESS-4's engine, a judging Étape: Entrée a document (PRD or Conception technique), Sortie a Verdict that the approval gate after it reads; when it has remarks its Verdict is « changements », which takes its Retour back to the Étape that wrote the document (« vers « PRD », 3 fois au plus » in the mockup `process`), whose Skill settles each remark (CONCEPTION-3's settle mode), then the Revue croisée judges the answers. The rules are the dotfiles' (`MaximeD1412/dotfiles`, `agents/skills/product-design/REFERENCE.md` « Revue croisée »).

## Current state of the code

- `STEP_IDS` has `cross-review`; no Contrat nor Skill for it on develop.
- Created by CONCEPTION-3: `design_documents`, the remarks format (`<!-- crewdeck:remarks -->`, `<!-- crewdeck:answers -->`, `packages/contracts/src/design/remarks.ts`, `apps/runner/internal/remarks/`), the `remarks-answered` check, the settle mode of the document Skills, the re-check on a push.
- Created by CONCEPTION-4: the `approval` gate reading its Verdict Entrées, the « Vérifications » `CheckRow` per Verdict Entrée of the review page. By CONCEPTION-7: the technical-design Skill.
- Created by PROCESS-1: the `cross-review` kind (judges). By PROCESS-6: a Verdict « changements » taking the Retour (`iteration` + 1), `loop-back.exhausted`, and a judging Étape without Retour stopping its item on that Décision without « Encore un passage ».
- Created by RUNNER-12: agent Sessions, embedded Skills, `step.report`. By MIROIR-7: `miroir pr view|comment` for both Sources. By PARAM-2: the Rôle `review` and its Moteur (another Moteur than the Code's by default).

## To do

- **Kind handler** `apps/server/src/process/engine/kinds/cross-review.ts` (kind `cross-review`), domain `apps/server/src/designs/cross-review.ts`:
  - `start(tx, stepRun)`: RUNNER-12's agent Session with its `role` Outil (the Rôle Review), its `skill` Outil and the Contrat `cross-review`, in a worktree of the document's change branch at its `verdictSha`; arguments `{ documentType: 'prd' | 'technical-design', changeNumber, iteration }`.
  - On `passed` with `step.report { figures: { outcome: 'settled' | 'changes', remarks, high, nonRetenues, commentId } }`: `settled` gives the Verdict « réglée » (passed) on its Sortie; `changes` gives the Verdict « changements » (PROCESS-6 takes the Retour, or stops the Conception on `loop-back.exhausted` without « Encore un passage » when the Process draws none); the figures kept on the StepRun's report for the page; `design.upserted`.
  - On `failed` (a Moteur's limit, a timeout): ATOI-2's « Étape échouée » with « Relancer l'Étape »; the gate after it waits for its Verdict.
- **Skill** `apps/runner/skills/cross-review/SKILL.md` (the reviewer), from the dotfiles' rules:
  - pass 1: reads the document (and, for a technical design, the PRD and `CONTEXT.md`), writes `.crewdeck/cross-review.json` `{ remarks: [{ id: 'R1'…, severity: 'high' | 'medium' | 'low', file, anchor, quote, text }] }` in French, posts them as one remarks comment on the change (`crewdeck-runner miroir pr comment <n> --body-file …`, CONCEPTION-3's format, the severity in each block); `outcome: 'changes'` when there is a remark, else `settled` with the comment « Revue croisée : aucune remarque »;
  - pass 2 and after (`iteration` > 1): reads its previous remarks and the author's answers (`miroir pr view <n> --json comments`), writes `settled: [{ id, accepted, why }]` (a fix checked in the files, a « non retenue » accepted when its reason is checkable, a `high` one only then), posts the judgement as a comment; `outcome: 'settled'` when every remark is accepted, else `changes`; it raises no new remark other than `high` ones.
  - then `crewdeck-runner etape report`. `.crewdeck/cross-review.json` stays on the Runner (never sent to the server).
- **Runner** `apps/runner/internal/steps/crossreview/`: the context (the document's paths from the change's files, the previous remarks comment's id on a later pass).
- **Contrat** `packages/contracts/src/contrats/cross-review.ts`, version 1:
  - `cross-review.remarks.schema` (`json` `.crewdeck/cross-review.json` against `zCrossReviewFile` in `packages/contracts/src/design/cross-review.ts`), « Les remarques de la revue croisée sont lisibles »;
  - `cross-review.comment` (`check` `cross-review-comment`, `checks/cross_review_comment.go`): the change has the comment this pass posted (its id in the report), holding every remark, read through the Miroir for either Source, « Les remarques sont sur le changement »;
  - `cross-review.settled.complete` (`check` `cross-review-settled`): on a later pass, one judgement per remark of the previous pass, each with its `why`, « Chaque remarque de la passe précédente est jugée »;
  - Fixtures passing and failing per rule.
- **Web**: CONCEPTION-4's « Vérifications » row for a Verdict Entrée from a Revue croisée shows « <Moteur> · réglée », « N non retenues », « en cours », « échouée : <reason> »; CONCEPTION-2's track gets the meta « réglée par <Moteur> » or « passage 2 · N remarques ».

## Decisions already made

- The Revue croisée is one Étape that judges, the author's fixes being the authoring Étape's next pass through the Retour: the reviewer (Rôle Review, independent) never edits the document, the author (who knows the rounds' decisions) never judges itself.
- It runs on the document's change, after its Contrat passed and before the Pilote's gate: the change is how the product knows the document on either Source.
- A pass after the first raises only `high` remarks, so that the Retour converges within its maximum.
- A failed Revue croisée blocks its gate until it is rerun, as any Étape whose Sortie feeds another (ADR 0011); a Pilote who does not want it removes it from the Process.
- No Revue croisée on the mockups nor the Tickets in « Process Crewdeck » (the dotfiles' « What has none »); a Pilote may still draw one on any document of the catalogue's types.

## Acceptance criteria

- [ ] On « Process Crewdeck », a passed PRD starts « Revue croisée du PRD »; a pass with two remarks posts one comment on the change and gives « changements »; the PRD reruns (`iteration` 2) in settle mode; the next Revue croisée pass accepts the answers and gives « réglée »; only then the gate raises « Conception à relire », its page showing « <Moteur> · réglée ».
- [ ] A pass without remark gives « réglée » at once with the comment « Revue croisée : aucune remarque ».
- [ ] The third « changements » reaches the Retour's maximum and raises `loop-back.exhausted` (PROCESS-6).
- [ ] A Revue croisée without Retour in its Process that has remarks stops the Conception on `loop-back.exhausted` without « Encore un passage ».
- [ ] A remark without judgement on a later pass fails `cross-review.settled.complete`; a report whose comment is missing fails `cross-review.comment` (Go fixtures, a GitHub change and a Local one).
- [ ] A reviewer's Moteur at its limit fails the Étape; « Relancer l'Étape » runs it again.
- [ ] The Revue croisée of the technical design runs the same way after its report.

## Verification

- `cd apps/runner && go test ./internal/contrat/... -run CrossReview && go test ./internal/steps/crossreview/`
- `pnpm exec nx test server -- src/designs/cross-review.spec.ts src/process/engine/kinds/cross-review.spec.ts`
- `pnpm exec nx test-integration server -- designs`
- `pnpm exec nx run contracts:generate` with no diff; `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing (the Skill ships in the Runner's release).

## Out of scope

- The author's settle mode: CONCEPTION-3 (and each document Skill). Taking the Retour: PROCESS-6.
- The Review of a Ticket's change: BOUCLE-4.
- Catching up a Revue croisée on an already approved document (the dotfiles' `--cross-review`): not at the MVP.

## Dependencies

- CONCEPTION-4.
