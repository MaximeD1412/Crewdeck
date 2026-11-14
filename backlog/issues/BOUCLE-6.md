---
id: BOUCLE-6
title: "The visual-review kind: captures against the mockups, approve and merge, or ask for changes through the Retour"
epic: BOUCLE
type: feature
priority: P1
size: M
milestone: M4 Boucle
blocked_by: [BOUCLE-4, CORE-7, PROCESS-5, SOURCE-4]
adr: [0002, 0003, 0006, 0009]
risques: []
stories: [US-36, US-26]
screens: [revue-visuelle, revue-visuelle-confirmation-merge, revue-visuelle-changements]
revue_visuelle: true
video: false
reprend: 87
---

## Context

US-36: the Pilote reviews the captures of a **Ticket** that has screens and either approves it, which merges its **Changement de code**, or asks for changes with a comment the **Boucle** takes up, while the Boucle goes on with the Tickets that do not depend on it. The **Revue visuelle** is the Pilote's gate: since the refonte of the PRD (the Étapes optionnelles are gone) it runs because it is an **Étape** of the Projet's **Process** — kind `visual-review`, a gate that judges, handled by PROCESS-4's engine — not because a Projet turned an Étape optionnelle on. Its **Entrées** are the Changement de code and the **Maquettes**, fed by lineage from the Ticket's own Conception (PROCESS-5), or « absente », the captures then judged alone. The approval is the **Action sensible** `merge` confirmed by the core (US-26), bound to the commit whose captures the Pilote saw (ADR 0002). « Demander des changements » gives the Verdict « changements », which takes the Phase's **Retour** (PROCESS-6). The images are read by the browser: from GitHub with the user token, or from the Local folder through the encrypted relay (ADR 0003).

## Current state of the code

- `packages/contracts/src/api/decisions.ts`: `visual-review` in `DECISION_KINDS`; `packages/contracts/src/api/sensitive-actions.ts`: `merge`; `apps/server/src/sensitive-actions/`: `@SensitiveAction`; `apps/web/src/dialogs/confirm.ts`: `confirmSensitiveAction`. No capture code.
- Created by BOUCLE-4: the `merge` kind and `mergeGate` (its `confirmedSha`), `judgedVerdicts`. Created by BOUCLE-3: `visualReview` in the Code StepRun's report (the Runner's reading of the label), the rule `code.pr.captures`, the Code Skill's « Modes » (`visual-fix` empty). Created by BOUCLE-5: protocol `comment.write`, the Ticket's page. Created by BOUCLE-2: the slot (a gate needs none), `LoopRecord`.
- Created by PROCESS-1: kind `visual-review` (gate, judges; Entrées `code-change`, `mockups`; Sortie `verdict`). Created by PROCESS-4: the kind registry; PROCESS-5: Entrées fed across Phases by lineage, the absent Entrée; PROCESS-6: Retours, « Demander des changements » hidden without one.
- Created by SOURCE-4: the document reader (GitHub fetcher, Local fetcher `artifact.read { kind: 'file' }`). Created by UI-6: `Capture`, `CheckRow`; UI-2, UI-4: `Tabs`, `Chip`, `Dialog`, `Select`, `TextField`. Created by ATOI-1: the « À toi » row « Revue visuelle ».
- Source: the founder's `agent-loop` « Visual review » (dotfiles repository `MaximeD1412/dotfiles`, `agents/tools/agent-loop/README.md`, `prompts/fix-visual-review.md`).

## To do

- Skill `code`, with `visualReview`: capture each screen the Ticket changes at 390 × 844 and 1280 × 800 with the capture command its conventions file names (Crewdeck's `scripts/captures.sh`), push them to the orphan branch `captures/<n>` of `origin` (GitHub, or the Local folder), write `.crewdeck/captures.json` (`[{ screen, state?, width, path, mockup? }]`, `mockup` the capture path of that screen in the Projet's `design/screens.json` when it has one) and add `captures`, `capturesCommit` to its report; mode `visual-fix` from `fix-visual-review.md` (read the comment after the last `<!-- crewdeck:visual-changes -->` on the change, fix, reply, push, refresh the captures); mode `captures` (refresh the captures of the current head only).
- Prisma `VisualCaptureSet` (scoped): `id`, `pilotId`, `codeChangeId`, `headSha`, `capturesCommit`, `captures` (jsonb, paths and screen ids only), `createdAt`; unique (`codeChangeId`, `headSha`). Written from the Code StepRun's report.
- `apps/server/src/process/engine/kinds/visual-review.ts`, the `visual-review` handler:
  - `start`: when the report of the Code StepRun that produced the change says `visualReview: false` (the Ticket has no `revue-visuelle` label, read by the Runner on both Sources) → Verdict `ok` at once with `notApplicable: true`, no Décision. Else, with a `VisualCaptureSet` of the change's head: PhaseRun `waiting`, `visual-review` raised (label « #<n> <titre> » on GitHub, « #<n> » on Local; `metaParts` [« <k> captures »]; `params { sha, mockupsSha? }`, `mockupsSha` the Maquettes Entrée's SHA, null when absent); without one: the Code Étape reruns in `mode: captures` (PROCESS-6's rerun, not counted) and the gate starts again on its output.
  - A new head while it waits: the Décision is resolved (`outcome: superseded`) and the gate starts again on the new head.
- `apps/server/src/loops/visual-review.controller.ts`:
  - `POST /api/projects/:id/tickets/:number/visual-review/approve` `{ seq, sha }`, `@SensitiveAction('merge')`: the open `visual-review` Décision is required (else 422 `visual-review.not-waiting`); `sha` must equal the captures' and the change's head, else 409 `visual-review.stale`; Verdict `ok` at `sha` with `confirmedSha: sha`, so the Merge passes even if the Boucle is stopped; Décision resolved (`outcome: approved`).
  - `POST /api/projects/:id/tickets/:number/visual-review/request-changes`, body `{ seq, commentId }` (GitHub: the browser posted the comment) or `{ seq, sealed }` (Local: BOUCLE-5's `comment.write` with `target.kind: 'change'`, `marker: 'visual-changes'`); 422 `visual-review.no-loop-back` when no Retour leaves this Étape; Verdict « changements » (PROCESS-6 takes the Retour to the Code in `visual-fix`), Décision resolved (`outcome: changes`), `LoopRecord.pilotIntervened: true`, `queuedAt` set.
  - 404 `ticket.not-found`, 401, 400 with `fields`; French messages in `apps/server/src/errors/messages.ts`.
- Web:
  - Router `/projets/:id/tickets/:number/revue-visuelle`; `apps/web/src/views/revue-visuelle.ts`; Composant `PageRevueVisuelle` (`packages/contracts/src/composants/page-revue-visuelle.ts`, `packages/skin-passerelle/src/page-revue-visuelle.ts`, in `COMPOSANTS`), actions `approve` (`sensitive: true`), `requestChanges` (`{ screen?, text }`, absent when the Étape has no Retour), `openAtSource`; t() keys under `revueVisuelle.*`.
  - Header « #<n> <titre> », « <Projet> · revue visuelle », « Demander des changements » and « Approuver et merger » (repeated at the foot); Banner « La Boucle continue sans toi » « Pendant ta revue, la Boucle avance sur les Tickets de <Projet> qui ne dépendent pas de #<n>. ».
  - Tabs per screen of the captures; « Avant toi » (CheckRow Checks « 4 sur 4 », Review « <Moteur> · aucune remarque », from the PhaseRun's StepRuns); « Pull request » (PR, Branche, Captures « 2 écrans · 4 captures », « Voir sur GitHub » on GitHub only).
  - At 390: tabs « Maquette » / « Livré » and chips 390 / 1280 over one `Capture`; at 1280: cards « Téléphone · 390 » and « PC · 1280 », the mockup beside the delivered capture. Images through the document reader: the captures on `captures/<n>` at `capturesCommit`, the mockup at `mockupsSha` (the Conception's approved commit) or, without it, at the change's head; a screen without mockup shows the delivered capture alone.
  - Approve: `confirmSensitiveAction` « Merger la PR de #<n> ? », action « Approuver et merger », consequences « Tu approuves la revue visuelle de #<n> <titre> (<Projet>). La PR #<pr> est mergée dans <branche>. Les Tickets qui dépendent de #<n> deviennent prêts et la Boucle les prend. ».
  - Changes: `Dialog` « Demander des changements »: « Ton commentaire part à la Boucle : l'agent de Code reprend #<n> avec lui, puis la revue visuelle te revient. », Select « Écran concerné (facultatif) », TextField « Ce qu'il faut changer », « Annuler », « Envoyer à la Boucle »: on GitHub the browser posts the comment (`<!-- crewdeck:visual-changes -->`, the screen, the text) then calls `request-changes` with its id; on Local it seals the same text (`comment:<projectId>`) and sends `sealed`.
  - The « À toi » `visual-review` row opens this page (« Relire »).
- Test scenarios `apps/server/src/testing/scenarios/revue-visuelle.ts` (`revue-visuelle`, `revue-visuelle-confirmation-merge`, `revue-visuelle-changements`), the fake GitHub serving the images, Playwright `apps/web/e2e/revue-visuelle.spec.ts`.

## Decisions already made

- Mockup: `revue-visuelle`, `revue-visuelle-confirmation-merge`, `revue-visuelle-changements` (pages `design/screens/crewdeck/revue-visuelle.html`, `…/revue-visuelle-confirmation-merge.html`, `…/revue-visuelle-changements.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The dictation icon of the comment field is IDEE-4's.
- A Ticket without screens passes the Étape at once (`notApplicable`): the Étape is in the Process, the Ticket simply has nothing to look at; the Ticket's page leaves it out of its track.
- Only Crewdeck's approval counts; a GitHub « Approve » review is ignored, a merge at the Source by the Pilote is BOUCLE-4's `merged-by-pilot`.
- The approval is its own Action sensible: it merges even with the Boucle stopped, at the SHA confirmed, never another.
- The server never reads the images nor the comment: paths, SHAs and a comment id, or a ciphertext relayed to the Runner.

## Acceptance criteria

- [ ] A Ticket labelled `revue-visuelle` whose Review and checks passed on `a1…`, with captures of `a1…`, stops in the Revue visuelle, raises « Revue visuelle · #38 Page Planning », and the Boucle admits a ready Ticket that does not depend on #38.
- [ ] A Ticket without the label (GitHub, or Local with its labels sealed) passes the Étape with no Décision and is merged by the gate.
- [ ] Approving after the core's confirmation merges with `sha: a1…`, even with the Boucle stopped; if the head moved, 409 `visual-review.stale` and nothing is merged.
- [ ] Asking for changes on GitHub (a comment id) and on Local (a ciphertext through `comment.write`) gives « changements »; the Code Étape reruns in `visual-fix`, and the Revue visuelle comes back after the checks and the Review.
- [ ] A Process whose Revue visuelle has no Retour hides « Demander des changements » and the route answers 422 `visual-review.no-loop-back`.
- [ ] The mockup shown is the one of the Ticket's Conception (`mockupsSha`); a Ticket without Conception shows the mockup at the change's head, or the captures alone.
- [ ] Routes: 422 `visual-review.not-waiting`, 409 stale `seq`, 404 for another Pilote's Ticket, 401, 400 with `fields`.
- [ ] The page matches the three mockups at 390 and 1280 px (Playwright against the fake Runner and the fake GitHub, axe without violations); the captures come from those tests.

## Verification

- `pnpm exec nx test server -- src/process/engine/kinds/visual-review.spec.ts`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- loops`
- `pnpm exec nx test skin-passerelle -- src/page-revue-visuelle.spec.ts`
- `pnpm exec nx e2e web -- revue-visuelle.spec.ts`
- `scripts/captures.sh revue-visuelle revue-visuelle-confirmation-merge revue-visuelle-changements`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

A migration (table `visual_capture_sets`). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- Retours, their maximum and `loop-back.exhausted`: PROCESS-6. The Maquettes fed by lineage: PROCESS-5.
- The document reader and the relay: SOURCE-4. The Ticket's page and blocked Tickets: BOUCLE-5. Dictation: IDEE-4.
- An automatic visual audit before the review (Bêta).

## Dependencies

- BOUCLE-4.
- CORE-7.
- PROCESS-5.
- SOURCE-4.
