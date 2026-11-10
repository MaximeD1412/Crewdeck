---
id: CONCEPTION-10
title: "Validating the Tickets of a Conception in one pass"
epic: CONCEPTION
type: feature
priority: P1
size: M
milestone: M6 Conception
blocked_by: [CONCEPTION-9]
adr: [0002, 0003, 0006, 0008]
risques: []
stories: [US-12, US-26]
screens: [decoupage, decoupage-confirmation]
revue_visuelle: true
video: false
---

## Context

US-12: the Pilote validates the Tickets of an approved Conception in one pass, so that the agents know exactly what to build. Approving them is an Action sensible (US-26, `document.approve` on the Étape `split`): Crewdeck merges the Découpage's PR, then the Runner creates the issues ready for the Boucle (CONCEPTION-9). The proposed Tickets are files of the PR, read by the browser from GitHub (ADR 0002). This ticket builds `/conceptions/:id/tickets` and the « Tickets proposés » card of an incomplete Découpage on the Conception page.

## Current state of the code

- Created by CONCEPTION-4: `approve` and `request-changes` for any document Étape (`step: 'split'` included), the comment posted by the browser, the remarks pattern.
- Created by CONCEPTION-9: the `split` Étape, its PR with `backlog/backlog.json`, `backlog/epics/*.md`, `backlog/issues/*.md`; `onSplitApproved` creating the issues; the Go parser of the backlog's front matter (`apps/runner/internal/contrat/checks/backlog_parse.go`).
- Created by CONCEPTION-2: `PageConception` with its `aside` slot.
- Created by UI-2 / UI-4 / UI-6: `ListRow`, `StatusBadge`, `IconButton`, `TextField`, `CheckRow`, `KeyValue`.
- No Découpage page.

## To do

- `apps/web/src/backlog/parse.ts`: the TypeScript twin of the Go parser (front matter with `" #"` comments, sections, `- [ ]` count under the acceptance criteria, `blocked_by`, `screens`, `size`), and pure `summarize(tickets) → { count, sizes: { S, M, L }, criticalPath: id[] (the longest chain of `blocked_by`), incomplete: id[] (no criterion or a missing section) }`; unit-tested against this repository's own `backlog/` files.
- `/conceptions/:id/tickets`: `apps/web/src/views/decoupage.ts`, Composant `PageDecoupage` (`packages/contracts/src/composants/page-decoupage.ts`, skin implementation) with `examples`.
  - The PR's `backlog/issues/*.md` read by the browser at the `split` `DesignStep`'s `headSha` with the user token (`@tanstack/query-core`, keyed by repository + SHA + path).
  - Header « Découpage · <title> », « <Projet> · N Tickets », back to the Conception.
  - « Tickets proposés »: one `ListRow` per Ticket in dependency order, numbered `k · <title>`, meta « aucune dépendance » or « dépend de 1, 3 » (by the same numbers) · « écran <id> » for each screen · « N critères », a `StatusBadge` of its size, an `IconButton` « Remarque sur ce Ticket » opening a `TextField` « Ta remarque » under the row; a Ticket in `incomplete` gets a `caution` tone and « Incomplet ». Opening a row shows its whole file rendered (`marked` + `DOMPurify`) through PROJET-5's `DocumentReader` Composant, the files read with PROJET-5's `apps/web/src/github/content.ts` in a `Dialog`.
  - « Vérifications »: `CheckRow` « Contrat du découpage » from the `StepRun`'s verdict (« N sur N » Tickets complete when passed, the failed labels otherwise).
  - « Résumé »: Tickets, Tailles (« 3 S · 3 M »), Chemin critique (« 1 → 3 → 5 »), Remarques.
  - « Demander des changements »: one PR comment from the browser, each remark under « **Sur <ID> · <title>** », then CONCEPTION-4's `request-changes`.
  - « Approuver les N Tickets »: Action sensible `document.approve`, title « Approuver les N Tickets de « <title> » ? », consequences « Crewdeck va : merger la PR #n du découpage dans <integration branch> ; créer les N Tickets sur GitHub, dans le Projet <Projet>, avec leurs dépendances ; les rendre prêts pour la Boucle. », then `approve` with `step: 'split'` and the head SHA. Disabled while the Contrat is not passed, with its reason.
- On the Conception page (CONCEPTION-2's `aside` slot), when the `split` Étape is `ready` or `incomplete`: the card « Tickets proposés » with the same rows (read-only, no remark), so that the incomplete state names the Tickets the banner talks about.
- The `document-review` Décision of the `split` Étape opens this page.
- Copy under `t('decoupage.*')`.
- Tests and scenarios: `apps/server/src/testing/scenarios/decoupage.ts` (the fake GitHub holding the mockup's six Tickets at a SHA, one with a remark), `apps/web/e2e/decoupage.spec.ts`; the `conception-contrat-incomplet` scenario of CONCEPTION-2 gains the files of its five Tickets.

## Decisions already made

- Mockup: `decoupage`, `decoupage-confirmation` (pages `design/screens/crewdeck/decoupage.html`, `…/decoupage-confirmation.html`; captures `design/screens/crewdeck/decoupage-390.png`, `…-1280.png` and the same for the state). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The confirmation names the merge of the PR as well as the creation (the mockup's dialog shows only the creation): an Action sensible says everything it does (US-26).
- The Tickets are numbered by their position for the Pilote; their IDs (`AGENDA-3`) appear in the opened file and in the comment's headings, which the `--fix` Skill parses.
- The browser computes the summary and the incomplete Tickets from the files; the server knows only the verdict's rule ids (ADR 0003).

## Acceptance criteria

- [ ] The page lists the six proposed Tickets read from the (fake) GitHub at the head SHA, with their dependencies, screens, criteria counts and sizes; the summary shows « 3 S · 3 M » and the critical path « 1 → 3 → 5 ».
- [ ] A remark on Ticket 5 counts in « Remarques »; « Demander des changements » posts one comment headed « **Sur AGENDA-5 · … »** and starts the `--fix` run.
- [ ] « Approuver les 6 Tickets » opens the product's confirmation naming the merge and the creation; confirming merges the PR with the head SHA and starts the issues' creation (CONCEPTION-9).
- [ ] An incomplete Découpage shows on the Conception page the two Tickets without criteria marked « Incomplet », and the approval is disabled with its reason.
- [ ] `summarize` gives the same incomplete Tickets as the Go Contrat on the same fixtures.
- [ ] Playwright at 390 and 1280 px on both states, axe without violations.

## Verification

- `pnpm exec nx test web -- src/backlog/parse.spec.ts src/views/decoupage.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/page-decoupage.spec.ts`
- `pnpm exec nx e2e web -- decoupage.spec.ts conception.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`
- `scripts/captures.sh` for `decoupage`, `decoupage-confirmation`.

## For prod

Nothing.

## Out of scope

- Editing a Ticket in the page: the Pilote asks for changes, the agent rewrites.
- The planning and ticket tree of the created Tickets: PILOTAGE-1, PILOTAGE-2.

## Dependencies

- CONCEPTION-9.
