---
id: IDEE-5
title: "An Idée straight to a Ticket: drafted by the Rôle Idée, validated or sent back"
epic: IDEE
type: feature
priority: P1
size: M
milestone: M5 Idées
blocked_by: [IDEE-3, BOUCLE-1, SESSION-2]
adr: [0002, 0003, 0005, 0008]
risques: [IA-6]
stories: [US-56]
screens: [idee-ticket]
revue_visuelle: true
video: false
---

## Context

US-56: a small fix goes from an Idée straight to a Ticket, without a Conception: the agent of the Rôle Idée drafts the Ticket from the Idée and its analysis, the Pilote validates it like the Tickets of a Conception, or sends it back with a comment the agent takes up; the validated Ticket joins the ready Tickets of its Projet. The design journal settled it: the draft is a GitHub issue **without** `ready-for-agent`, validating adds the label (the console's pattern). The model is the dotfiles `ideas ticket` command and `plan-backlog`'s single-ticket mode (`MaximeD1412/dotfiles`, `agents/tools/ideas/README.md` « To ticket », `agents/skills/plan-backlog/SKILL.md` « Single-ticket mode », `agents/skills/plan-backlog/ISSUE-TEMPLATE.md`). PILOTAGE-3's lead time needs the link from the Idée to its Ticket, set here.

## Current state of the code

- Created by IDEE-1 to IDEE-3: `Idea` (`ticketNumber` nullable, `targetProjectId`), the Idée page and its `actions` slot, the triage routes.
- Created by BOUCLE-1: `apps/server/src/tickets/` (`Ticket` mirrored from the issues' webhooks, `ready` from `ready-for-agent` and the blockers).
- Created by RUNNER-9 / RUNNER-10 / RUNNER-12: Sessions in a worktree of the Projet with a GitHub token, `StepRun`, `crewdeck-runner etape`.
- Created by RUNNER-11: the Contrat declarations and their interpreter.
- Created by SESSION-2: the Session panel (opened by « Ouvrir la session »).
- Created by CORE-3: `GitHubClient.addLabels`; the page's GitHub base URL from `GET /api/config`.
- No `idea-ticket` Étape.

## To do

- **Step** `idea-ticket` added to the Step ids of `packages/contracts/src/api/steps.ts` (the Rôle `idea`'s second Étape).
- **Contrat** `packages/contracts/src/contrats/idea-ticket.ts`, version 1, rules on the draft file `.crewdeck/ticket.md` (uncommitted, in the Session's worktree):
  - `idea-ticket.front-matter` (`front-matter`): `title` (≤ 100), `type` in `feature | fix | chore`, `size` in `S | M`, « Le Ticket a un titre, un type et une taille »;
  - `idea-ticket.sections` (`sections`): Context, Current state of the code, To do, Decisions already made, Acceptance criteria, Verification, Out of scope (their French titles when the Projet's `backlog/backlog.json` says `"language": "fr"`), « Le Ticket a les sections du modèle »;
  - `idea-ticket.criteria` (`pattern`): at least one `- [ ] ` line after the acceptance criteria heading, « Le Ticket a au moins un critère d'acceptation »;
  - `idea-ticket.issue` (`check` `ticket-issue`, `apps/runner/internal/contrat/checks/ticket_issue.go`): the issue of `.crewdeck/issue.json` exists on the Projet's repository, its body is the file's body, it has no `ready-for-agent`, « Le Ticket est créé sur GitHub, sans être prêt pour la Boucle ».
- **Skill** `apps/runner/skills/idea-ticket/SKILL.md`, ported from the single-ticket mode: read `.crewdeck/context.json` (the Idée's text and analysis decrypted by the Runner, the Projet, `changesRequested` when sent back), read the code it touches in the worktree, write `.crewdeck/ticket.md` with the Projet's template (`backlog/` template when the Projet has one, else the plan-backlog template), then `crewdeck-runner etape create-issue --file .crewdeck/ticket.md`, then `crewdeck-runner etape report`. When the request is too big for one Ticket, it writes the first one and says so in « Context ».
- **Runner** `apps/runner/internal/steps/ideaticket/`: prepares the context (the comment's body fetched with the Session's token when `commentId` is given), and the verb `crewdeck-runner etape create-issue --file <f>` in `apps/runner/internal/github/issues.go`: creates the issue (title, body without the front matter, labels `type:<type>`, the earliest open milestone of the repository when there is one), or updates the issue already in `.crewdeck/issue.json` (a second run after changes), and writes `.crewdeck/issue.json` `{ number }`. The `step.report` carries `{ issueNumber }` only.
- **Server** `apps/server/src/ideas/to-ticket.ts`:
  - `POST /api/ideas/:id/to-ticket { seq }` (« En faire un Ticket »): the Idée is `to-triage` or `analysed`, its target Projet known and not « nouveau » (422 `ideas.no-target-project`), no draft running (422 `ideas.ticket-drafting`). Starts a `StepRun` (step `idea-ticket`, Rôle `idea`, `subjectType: 'idea'`, `projectId` the target) in a worktree of the Projet's integration branch.
  - On a `passed` verdict: `Idea.ticketNumber = issueNumber`; the `ticket-draft` Décision raised (subject the Idée, `projectId`, label « #<n> <Ticket's title> » (the kind « Ticket à valider » is rendered by ATOI-1) from the mirrored Ticket, meta « <Projet> · depuis l'Idée #<m> »).
  - `Ticket.ideaId` (nullable column created by BOUCLE-1; no migration here): set when the mirrored Ticket exists, and by a hook of the tickets mirror (`TicketsService.onUpsert`) for a Ticket mirrored after the report (`linkTicketToIdea(tx, projectId, number, ideaId)`). CONCEPTION-9 reuses the column.
  - `POST /api/ideas/:id/ticket/validate { seq }` (« Valider le Ticket »): adds `ready-for-agent` through `GitHubClient.addLabels`, the Idée becomes `retained` (`triagedAt`), the Décision resolved (outcome `validated`). 422 `ideas.no-ticket-draft`.
  - A draft whose issue is closed on GitHub before validation (seen through `TicketsService.onUpsert`): the Décision is resolved (outcome `closed`), `Idea.ticketNumber` cleared, the Idée stays where it was in triage.
  - `POST /api/ideas/:id/ticket/request-changes { commentId: number, seq }`: the browser has posted the comment; resolves the Décision (outcome `changes`) and starts a new `idea-ticket` `StepRun` with `{ issueNumber, commentId }` as the Skill's arguments.
- **Web**:
  - « En faire un Ticket » in the Idée's `actions` slot and on the list's aside, with the line « Un petit correctif peut devenir un Ticket directement, sans Conception. »; disabled with its reason when the Projet visé is « nouveau ».
  - The page `/idees/:id/ticket` (`PageTicketDraft`, `packages/contracts/src/composants/page-ticket-draft.ts`, skin implementation; view `apps/web/src/views/ticket-draft.ts`): header « Ticket à valider », « <Projet> · depuis l'Idée #m », back to the Idée; the explanation paragraph; the card « Ticket proposé » with the issue's title and body read by the browser from GitHub with the user token (`@tanstack/query-core`, key repository + issue number + `updated_at`), rendered with `marked` and sanitized with `DOMPurify` through PROJET-5's `DocumentReader` Composant, the files read with PROJET-5's `apps/web/src/github/content.ts`; « Rôle Idée · <Moteur> · <time> »; the card « D'où il vient » (the Idée's number, title, quoted text, Projet, impact, effort); « Demander des changements » and « Valider le Ticket » (primary).
  - « Demander des changements » opens a `Dialog` with a `TextField` « Ce qui doit changer »; sending posts the comment on the issue from the browser (`POST {githubApiUrl}/repos/:o/:r/issues/:n/comments` with the user token) then calls `request-changes` with the comment's id. The fake GitHub controller (CORE-3) gains that route.
  - While the draft runs: the Idée page shows « Le Ticket est en cours de rédaction » with « Ouvrir la session » (`?session=<id>`).
  - Copy under `t('ticketDraft.*')`.
- **Tests and scenarios**: `apps/server/src/testing/scenarios/idee-ticket.ts`, `apps/web/e2e/idee-ticket.spec.ts`; Go tests of `create-issue` against an `httptest` GitHub.

## Decisions already made

- Mockup: `idee-ticket` (page `design/screens/crewdeck/idee-ticket.html`; captures `design/screens/crewdeck/idee-ticket-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The draft is only an issue (design journal, 2026-11-10): no ticket file is committed and no PR opened, so validating merges nothing; it is not an Action sensible (US-26's list has no « validate an Idée's Ticket ») and has no confirmation, as the mockup shows.
- The server never reads nor writes the issue's body (ADR 0002): the Runner creates it, the browser reads it and posts the comment; the server only adds a label.
- The Idée → Ticket link travels as an issue number in the `step.report`, never as a marker the server would have to read in the body.
- A drafted issue the Pilote never validates stays open without `ready-for-agent`; the Boucle never takes it (BOUCLE-2 takes only `ready` Tickets).

## Acceptance criteria

- [ ] « En faire un Ticket » on an analysed Idée of « Site mairie » starts the `idea-ticket` Étape; the fake Runner creates issue #70 without `ready-for-agent`; « À toi » shows « Ticket à valider · #70 … ».
- [ ] The Ticket page shows the issue's body read from (fake) GitHub by the browser; the server's requests contain no body (the fake GitHub's `calls` show no read of it by the server).
- [ ] « Valider le Ticket » adds `ready-for-agent` on #70, the Ticket becomes ready in the store, the Idée is `retained`, the Décision is resolved.
- [ ] « Demander des changements » posts the comment from the browser, then a new run updates the same issue #70 (no second issue).
- [ ] A draft without acceptance criteria fails `idea-ticket.criteria` and raises « Contrat incomplet » (ATOI-2); an issue with `ready-for-agent` fails `idea-ticket.issue` (Go tests).
- [ ] `Ticket.ideaId` of #70 is the Idée's id, whether the Ticket was mirrored before or after the report.
- [ ] Route baseline for `to-ticket`, `ticket/validate`, `ticket/request-changes`: nominal, 400, 401, 404 for another Pilote's Idée, 409 stale `seq`, 422 for each rule.
- [ ] Playwright at 390 and 1280 px on `idee-ticket`, axe without violations.

## Verification

- `cd apps/runner && go test ./internal/contrat/... ./internal/steps/ideaticket/ ./internal/github/`
- `pnpm exec nx test server -- src/ideas/to-ticket.spec.ts`
- `pnpm exec nx test-integration server -- ideas`
- `pnpm exec nx e2e web -- idee-ticket.spec.ts`
- `pnpm exec nx run contracts:generate` with no diff; `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`
- `scripts/captures.sh` for `idee-ticket`.

## For prod

A Prisma migration (`tickets.idea_id`). Nothing else.

## Out of scope

- The Tickets of a Conception and their one-pass validation: CONCEPTION-9, CONCEPTION-10.
- A « Rejeter le Ticket » button: not at the MVP; the Pilote closes the issue on GitHub (handled above).

## Dependencies

- IDEE-3.
- BOUCLE-1.
- SESSION-2.
