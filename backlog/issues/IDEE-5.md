---
id: IDEE-5
title: "An Idée straight to a Ticket: drafted by the Rôle Idée at the Tickets' Source, validated or sent back"
epic: IDEE
type: feature
priority: P1
size: M
milestone: M5 Idées
blocked_by: [IDEE-3, BOUCLE-1, SESSION-2, MIROIR-7, BOUCLE-5]
adr: [0002, 0003, 0005, 0008, 0011, 0012]
risques: [IA-6]
stories: [US-56]
screens: [idee-ticket]
revue_visuelle: true
video: false
reprend: 74
---

## Context

US-56: a small fix goes from an Idée straight to a Ticket, without a Conception: the agent of the Rôle Idée drafts the Ticket from the Idée and its analysis, the Pilote validates it like the Tickets of a Conception, or sends it back with a comment the agent takes up; the validated Ticket joins the ready Tickets **at the Source of its Projet's Tickets**. The model is the dotfiles `ideas ticket` command and `plan-backlog`'s single-ticket mode (`MaximeD1412/dotfiles`, `agents/tools/ideas/README.md` « To ticket », `agents/skills/plan-backlog/SKILL.md` « Single-ticket mode », `agents/skills/plan-backlog/ISSUE-TEMPLATE.md`). PILOTAGE-3's lead time needs the link from the Idée to its Ticket, set here.

The refonte (PRD #169, ADRs 0011 and 0012) changes where the draft lives and how it is written: the Ticket is written at the Projet's Tickets' Source, Local (`tickets/<n>-<slug>.md`, `ready: false`) or GitHub (an issue without `ready-for-agent`), through `crewdeck-runner miroir issue create` (MIROIR-7), never by a GitHub-only verb; validating makes it ready at that Source. The catalogue has no kind for this draft: it is an action of the `idea-triage` gate (IDEE-3), the Ticket having the Idée's PhaseRun as its origin (ADR 0011, « Lineage »: « a Ticket drafted from an Idée has the PhaseRun that created it »). Nothing assumes GitHub is linked.

## Current state of the code

- No `ideas`, `tickets` module on develop. `DECISION_KINDS` has `ticket-draft`; `GitHubClient` (`apps/server/src/github/github.client.ts`) and the fake GitHub (`apps/server/src/testing/fake-github.ts`).
- Created by IDEE-1 to IDEE-3: `Idea` (`ticketNumber` nullable, `targetProjectId`), the Idée page and its `actions` slot, the triage routes, the `idea-triage` kind handler (`apps/server/src/process/engine/kinds/idea-triage.ts`).
- Created by BOUCLE-1: `tickets` (`source` `github|local`, number, state, `ready`, labels, sealed title for Local, nullable `ideaId`), `TicketsService` and its upsert hook, the GitHub side (`ready` from `ready-for-agent`).
- Created by SOURCE-2 / SOURCE-3: the Local Ticket file (`ready`, `labels`), `local.db`, `local.changed` writing the `tickets` rows. By SOURCE-4: `artifact.read` (`ticket` kind) and the web document reader with its GitHub and Local fetchers (`@tanstack/query-core`). By PROJET-5: the `DocumentReader` Composant.
- Created by MIROIR-6 / MIROIR-7: `crewdeck-runner miroir issue view|list` and `issue create|edit|comment` for both Sources.
- Created by RUNNER-12: Sessions of an agent StepRun, `crewdeck-runner etape start|report`, `step.report`, `step.verdict`. By RUNNER-11: the Contrat interpreter. By ATOI-2: `contract-incomplete`, `step-failed`. By SESSION-2: the Session panel (`?session=<id>`). By PROCESS-4: StepRuns, the engine's rerun.
- No Ticket draft.

## To do

- **The draft, an action of the triage gate** (`apps/server/src/ideas/to-ticket.ts`, called by the `idea-triage` handler):
  - `POST /api/ideas/:id/to-ticket { seq }` (« En faire un Ticket »): the Idée is `to-triage` or `analysed` with a waiting triage StepRun (422 `ideas.not-triageable`), its Projet visé known and not « nouveau » (422 `ideas.no-target-project`), no draft running (422 `ideas.ticket-drafting`). The gate's StepRun moves to « drafting » and starts an agent Session (RUNNER-12's start): Rôle the `role` Outil of the PhaseRun's `idea-analysis` Étape (the Rôle Idée, the account's when the Phase has none), Skill `idea-ticket`, Contrat `idea-triage`, a worktree of the Projet visé's integration branch (the Runner's clone for a Local Projet, SOURCE-2).
  - On `passed` with `step.report { figures: { ticketNumber } }`: `Idea.ticketNumber`; the `ticket-draft` Décision raised (subject the Idée, `projectId`, meta « <Projet> · depuis l'Idée #<m> »; its label never carries a Local Ticket's title, which the page decrypts from the store).
  - `POST /api/ideas/:id/ticket/validate { seq }` (« Valider le Ticket »): makes the Ticket ready at its Source: GitHub `GitHubClient.addLabels(repo, n, ['ready-for-agent'])`; Local the protocol `ticket.set-ready { projectId, numbers }` (server → Runner, `packages/contracts/src/runner/tickets.ts`: the Runner sets `ready: true` in each file through SOURCE-2's Ticket write and reports through `local.changed`; 422 `runner.offline` from `RunnerCommands.send`). Then the Idée `retained` (`triagedAt`), the gate's StepRun ends with outcome `ticket` (its Idée Sortie stays unfed: no Conception follows), the PhaseRun ends, the Décision resolved (outcome `validated`). 422 `ideas.no-ticket-draft` without a draft.
  - `POST /api/ideas/:id/ticket/request-changes { commentId, seq }`: the page has written the comment on the Ticket (below); the Décision resolved (outcome `changes`) and a new StepRun of the gate (the engine's rerun) drafts again with `{ ticketNumber, commentId }` as the Skill's arguments. 422 `ideas.no-ticket-draft`.
  - A draft closed at its Source before validation (`tickets` upsert hook: state `closed`): the Décision resolved (outcome `closed`), `Idea.ticketNumber` cleared, the gate's StepRun waits again.
  - Lineage: `Ticket.ideaId` and `Ticket.originPhaseRunId` (the Idée's PhaseRun; both nullable on `tickets`, added here if BOUCLE-1 or PROCESS-5 did not) set by `linkTicketToIdea(tx, projectId, number, ideaId, phaseRunId)` when the row exists, and by the `tickets` upsert hook for a row written after the report. CONCEPTION-9 reuses them.
  - Messages: `ideas.no-target-project` « Choisis d'abord le Projet de cette Idée. », `ideas.ticket-drafting` « Le Ticket de cette Idée est en cours de rédaction. », `ideas.no-ticket-draft` « Cette Idée n'a pas de Ticket à valider. ».
- **Contrat** `packages/contracts/src/contrats/idea-triage.ts`, version 1, the `idea-triage` kind's Contrat: rules on the drafted Ticket whose number is in `.crewdeck/report.json`, read through the Miroir's view (both Sources), none when the gate has no draft:
  - `idea-triage.ticket.draft` (`check` `ticket-draft`): the Ticket exists at the Projet's Tickets' Source, open and not ready, « Le Ticket est écrit à sa Source, sans être prêt pour la Boucle »;
  - `idea-triage.ticket.labels` (`check` `ticket-labels`): one `type:<feature|fix|chore>` and one `size:<S|M>` label, « Le Ticket a un type et une taille »;
  - `idea-triage.ticket.sections` (`check` `ticket-sections`): the template's sections in the body (French titles when the Projet's backlog says `"language": "fr"`), `Reproduction` for a `fix`, « Le Ticket a les sections du modèle »;
  - `idea-triage.ticket.criteria` (`check` `ticket-criteria`): at least one `- [ ] ` line under the acceptance criteria, « Le Ticket a au moins un critère d'acceptation ».
  - `apps/runner/internal/contrat/checks/ticket_body.go` (the body's sections and criteria, shared with CONCEPTION-9) and `ticket_draft.go`, with passing and failing fixtures for a Local Ticket file and a GitHub issue; the checks read the Miroir through the checks' environment (a `mirror` reader given to `check` functions, added here if no earlier ticket gave them one).
- **Skill** `apps/runner/skills/idea-ticket/SKILL.md`, ported from the single-ticket mode: read `.crewdeck/context.json` (the Idée's text and analysis decrypted by the Runner, the Projet, its Tickets' Source), read the code it touches in the worktree, write the Ticket with the Projet's template (`backlog/` template when the Projet has one, else the plan-backlog template), then `crewdeck-runner miroir issue create --title … --body-file … --label type:<t> --label size:<s>` (never `ready-for-agent`), or `miroir issue edit <n>` on a redraft after reading the comment with `miroir issue view <n> --json comments`, then `crewdeck-runner etape report`. A request too big for one Ticket: it writes the first one and says so in « Context ».
- **Runner** `apps/runner/internal/steps/ideaticket/`: prepares the context (the Idée decrypted with the vault key, `ticketNumber` and `commentId` on a redraft); the `ticket.set-ready` handler.
- **Comment on a Ticket from the page** (`apps/web/src/api/ticket-comments.ts`): GitHub: `POST {githubApiUrl}/repos/:o/:r/issues/:n/comments` with the user token (the fake GitHub controller gains that route); Local: BOUCLE-5's protocol `comment.write` (`target: { kind: 'issue' | 'change', number }`, the text sealed by the page under the vault key, additional data `comment:<projectId>`), this ticket adding the `marker` value `remark` and a route `POST /api/projects/:id/comments { seq, target, sealed }` that sends it and waits for `comment.written` (never storing nor logging `sealed`); the Runner records it as the Pilote's comment in `local.db` and answers `{ commentId }`. Both return the comment's id. CONCEPTION-4, CONCEPTION-6 and CONCEPTION-10 reuse it (`kind: 'change'` for a document's change).
- **Web**:
  - « En faire un Ticket » in the Idée's `actions` slot and the list's aside, with « Un petit correctif peut devenir un Ticket directement, sans Conception. »; disabled with its reason when the Projet visé is « nouveau ».
  - The page `/idees/:id/ticket` (`PageTicketDraft`, `packages/contracts/src/composants/page-ticket-draft.ts`, skin implementation, in `COMPOSANTS`; view `apps/web/src/views/ticket-draft.ts`): header « Ticket à valider », « <Projet> · depuis l'Idée #m », back to the Idée; the explanation paragraph; the card « Ticket proposé » with the Ticket's title and body read by SOURCE-4's reader (`ticket` kind: GitHub with the user token, Local through the relay) and rendered by `DocumentReader`; a Local Ticket with the Runner « hors ligne » shows its title and state only; « Rôle Idée · <Moteur> · <time> »; the card « D'où il vient » (the Idée's number, title, quoted text, Projet, impact, effort); « Demander des changements » and « Valider le Ticket » (primary).
  - « Demander des changements » opens a `Dialog` with a `TextField` « Ce qui doit changer »; sending writes the comment (above) then calls `request-changes` with its id.
  - While the draft runs: the Idée page shows « Le Ticket est en cours de rédaction » with « Ouvrir la session » (`?session=<id>`). A validated Idée shows « Devenue le Ticket #n » instead of « Lancer la Conception ».
  - Copy under `t('ticketDraft.*')`.
- **Tests and scenarios**: `apps/server/src/testing/scenarios/idee-ticket.ts` (`idee-ticket` on a GitHub Projet, and a Local variant for the e2e), `apps/web/e2e/idee-ticket.spec.ts`; Go tests of the checks and of `ticket.set-ready` on a temporary Local folder.

## Decisions already made

- Mockup: `idee-ticket` (page `design/screens/crewdeck/idee-ticket.html`; captures `design/screens/crewdeck/idee-ticket-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The draft is only a Ticket at its Source, not ready: no ticket file committed, no change of code opened, so validating merges nothing; it is not an Action sensible (US-26's list) and has no confirmation, as the mockup shows.
- The draft is the triage gate's action rather than an Étape of its own: « Process Crewdeck »'s « Idée » Phase has no such Étape, and the Ticket must not feed the Conception Phase. Its Contrat is the gate's (`idea-triage`), which checks only a drafted Ticket.
- The server never reads nor writes a Ticket's body (ADR 0002, ADR 0012): the agent writes it through the Miroir, the browser reads it through SOURCE-4's reader, the Pilote's comment goes from the browser to GitHub or, for Local, sealed through the relay to `local.db`; the server only sets the readiness (a GitHub label, or `ticket.set-ready`).
- The Idée → Ticket link travels as a number in the `step.report`, never as a marker the server would have to read in the body.
- A draft the Pilote never validates stays open and not ready; the Boucle never takes it (BOUCLE-2 admits only ready Tickets).

## Acceptance criteria

- [ ] « En faire un Ticket » on an analysed Idée of a GitHub Projet starts the draft; the fake Runner creates issue #70 without `ready-for-agent`; « À toi » shows « Ticket à valider · #70 … ».
- [ ] The same on a Local Projet writes `tickets/70-<slug>.md` with `ready: false` in the Runner's view; the Décision's label holds no title in clear.
- [ ] The Ticket page shows the body read by the browser (fake GitHub, or the relay for Local); the server's requests and logs contain no body.
- [ ] « Valider le Ticket » makes #70 ready at its Source (the label on GitHub, `ready: true` on Local), the Ticket is ready in the store, the Idée is `retained` with « Devenue le Ticket #70 », the Décision is resolved, and no Conception can start from it.
- [ ] « Demander des changements » writes the comment (issue comment on GitHub, `local.db` on Local), then a new draft edits the same Ticket #70 (no second Ticket).
- [ ] A draft without acceptance criteria fails `idea-triage.ticket.criteria` and raises « Contrat incomplet » (ATOI-2); a draft already ready fails `idea-triage.ticket.draft` (Go tests, both Sources).
- [ ] `Ticket.ideaId` and `originPhaseRunId` of #70 are set, whether its row was written before or after the report.
- [ ] Route baseline for `to-ticket`, `ticket/validate`, `ticket/request-changes`: nominal, 400, 401, 404 for another Pilote's Idée, 409 stale `seq`, 422 for each rule, 422 `runner.offline` on a Local validate with the Runner « hors ligne ».
- [ ] Playwright at 390 and 1280 px on `idee-ticket`, axe without violations.

## Verification

- `cd apps/runner && go test ./internal/contrat/... ./internal/steps/ideaticket/`
- `pnpm exec nx test server -- src/ideas/to-ticket.spec.ts`
- `pnpm exec nx test-integration server -- ideas`
- `pnpm exec nx test contracts -- src/contrats/idea-triage.spec.ts`
- `pnpm exec nx e2e web -- idee-ticket.spec.ts`
- `pnpm exec nx run contracts:generate` with no diff; `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`
- `scripts/captures.sh idee-ticket`.

## For prod

A Prisma migration only if this ticket adds `tickets.idea_id` or `tickets.origin_phase_run_id`. Nothing else.

## Out of scope

- The Tickets of a Conception and their one-pass validation: CONCEPTION-9, CONCEPTION-10.
- A « Rejeter le Ticket » button: not at the MVP; the Pilote closes the Ticket at its Source (handled above).
- The agents' writes themselves: MIROIR-7. Reading a Local Ticket in the page: SOURCE-4.

## Dependencies

- IDEE-3.
- BOUCLE-1.
- SESSION-2.
- MIROIR-7.
- BOUCLE-5.
