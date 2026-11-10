---
id: CONCEPTION-9
title: "Découpage Étape: the official plan-backlog Skill, its Contrat, and the issues created after approval"
epic: CONCEPTION
type: feature
priority: P0
size: M
milestone: M6 Conception
blocked_by: [CONCEPTION-4, BOUCLE-1]
adr: [0002, 0004, 0005]
risques: [IA-6]
stories: [US-12, US-48]
screens: []
revue_visuelle: false
video: false
---

## Context

US-12: an approved Conception is split into Tickets the Pilote validates in one pass. The last Étape of a Conception: the Rôle Conception writes the backlog files in a design PR, checked against the Découpage Contrat (ADR 0005: the rules of `plan-backlog`'s `check-backlog.mjs`); once the Pilote approves them (CONCEPTION-10), the Runner creates the issues with the Session's token (ADR 0002: the Tickets of a split are content the server must not carry), and the Conception is done. The Skill is ported from the dotfiles `plan-backlog` skill, full-pass mode (`MaximeD1412/dotfiles`, `agents/skills/plan-backlog/SKILL.md`, `REFERENCE.md`, `ISSUE-TEMPLATE.md`, `scripts/check-backlog.mjs`, `scripts/create-issues.py`). PILOTAGE-3's lead time needs every created Ticket linked to the Conception's Idée.

## Current state of the code

- Created by CONCEPTION-3 / CONCEPTION-4: the document lifecycle (`apps/server/src/designs/documents.ts`), approve with its `onSplitApproved` hook (a no-op), `request-changes`, the PR verb with `--label`.
- Created by IDEE-5 (milestone M5, taken before this one): `apps/runner/internal/github/issues.go` (creating and updating an issue with the Session's token), `Ticket.ideaId` and `linkTicketToIdea(tx, projectId, number, ideaId)`, the `TicketsService.onUpsert` hook. If IDEE-5 is not merged when this ticket starts, write these here, under the same names, and IDEE-5 reuses them.
- Created by BOUCLE-1: the Tickets mirrored from the issues' webhooks (`apps/server/src/tickets/`).
- Created by RUNNER-11 / RUNNER-12: Contrats, `check` functions, embedded Skills, `crewdeck-runner etape`.
- No plan-backlog Skill, no `split` Contrat, no issue creation of a backlog.

## To do

- **Skill** `apps/runner/skills/plan-backlog/` (`SKILL.md`, `REFERENCE.md`, `ISSUE-TEMPLATE.md`), ported for a full pass of one PRD file: frame the epics and milestones (`backlog/backlog.json`, `backlog/epics/<EPIC>.md`), the decomposition table validated in one closed round (`AskUserQuestion`), `backlog/issues/<ID>.md` with the template (current state read from the code, never from memory), `docs/pilotage/risques.json`'s `tickets`; the design PR on branch `docs/backlog-<slug>` into the integration branch, title `docs(backlog): découpage de <title>`, label `conception`; `crewdeck-runner etape report` with `{ prNumber, branch, headSha, ticketCount }`. Dropped: `design start/done`, `create-issues.py`, the GitHub Project board (Crewdeck's planning replaces it), single-ticket mode (IDEE-5's `idea-ticket`), `reprend`. `--fix <commentId>`: the comment's remarks per Ticket (« **Sur <ID>** ») applied on the same branch.
- **Contrat** `packages/contracts/src/contrats/split.ts`, version 1, the rules of `check-backlog.mjs` ported to Go `check` functions in `apps/runner/internal/contrat/checks/backlog_*.go` (one parser `backlog_parse.go` shared, the same front matter parsing as the script, `" #"` comments included):
  - `split.front-matter` (`backlog-front-matter`, bloquant): every `backlog/issues/*.md` has the required keys, its `id` matches the file, its epic file exists, `type`, `priority`, `size`, `milestone` valid (milestones of `backlog/backlog.json`), « Chaque Ticket a son en-tête complet »;
  - `split.sections` (`backlog-sections`, bloquant): the template's sections in the backlog's language (`language` of `backlog.json`), `Reproduction` for a `fix`, « Chaque Ticket a les sections du modèle »;
  - `split.criteria` (`backlog-criteria`, bloquant): at least one `- [ ]` under the acceptance criteria, « Chaque Ticket a au moins un critère d'acceptation »;
  - `split.graph` (`backlog-graph`, bloquant): no unknown blocker, no cycle, no blocker in a later milestone, « Les dépendances sont connues, sans cycle ni jalon plus tardif »;
  - `split.references` (`backlog-references`, bloquant): cited ADRs, risks, stories (not removed) and screens exist, « Chaque story, écran, ADR et risque cité existe »;
  - `split.coverage` (`backlog-coverage`, attention): every `MVP` story and every screen of the PRD file the backlog covers is cited by a Ticket, « Chaque story MVP et chaque écran a un Ticket »;
  - `split.pr` (`pr`: base the integration branch, label `conception`).
  - The failed rule ids name the Tickets in the verdict's details only on the Runner's side (the server gets rule ids); fixtures passing and failing per rule, the passing one being this repository's own `backlog/`.
- **Creating the issues** after approval (`onSplitApproved`, server `apps/server/src/designs/split.ts`): the server starts a `StepRun` (step `split`, arguments `{ create: true, sha: approvedSha }`) run by the Runner **without a Moteur**: a Session of engine `none` whose only work is `crewdeck-runner etape create-issues` on a worktree at the merge's SHA (add the `none` path to the Runner's Session start, `apps/runner/internal/session/`, if RUNNER-9 has none). `apps/runner/internal/github/backlog.go`, in this order and idempotent:
  1. labels (`epic:<x>`, `type:*`, `ready-for-agent`, `revue-visuelle`, `blocked:externe`), milestones without due date;
  2. one issue per epic file, then each Ticket in dependency order; an issue already created for an ID is found by the hidden marker `<!-- crewdeck:ticket <ID> -->` its body carries (the Runner may read bodies), so a rerun after an error creates nothing twice;
  3. labels per Ticket: `epic:<x>`, `type:<type>`, `priority:<P>` and `size:<S>` from the front matter (read by BOUCLE-1), `revue-visuelle` when `revue_visuelle` or `video`, `ready-for-agent` except `externe` and `hors_boucle`;
  4. native sub-issues (epic → Tickets) and native blocked-by;
  5. `step.report` with `{ created: [{ id, number }] }`.
- **Server** on that report: each created number linked to the Conception's Idée (`linkTicketToIdea`), the `split` `DesignStep` keeps `approved`, the Conception `done` with `doneAt`, `design.upserted`. A `failed` creation raises « Étape échouée » (ATOI-2); « Relancer l'Étape » reruns it safely.

## Decisions already made

- Issues are created by the Runner, never by the server (ADR 0002): bodies are content.
- No `backlog/issues-map.json` commit after creation (the server cannot commit content and the Runner does not push to the integration branch): the body marker gives the idempotence instead.
- The issue creation needs no agent, so it costs no AI usage: a Session of engine `none` reuses the Session's token and reporting.
- No GitHub Project board is created: the Projet's planning (PILOTAGE-1) and ticket tree (PILOTAGE-2) are Crewdeck's.
- `split.coverage` is `attention`: a backlog that leaves a story for later still passes, the Pilote sees it in the review.

## Acceptance criteria

- [ ] After the technical design's approval, the `split` Étape starts; a passing report makes it `ready` and raises « Conception à relire · Tickets « <title> » » with the Ticket count.
- [ ] A Ticket without acceptance criteria fails `split.criteria`; a cycle fails `split.graph`; an unknown story fails `split.references`; a missing MVP story only warns (`split.coverage` attention) — Go fixtures, and this repository's own backlog passes.
- [ ] Approving the split (CONCEPTION-10) runs `create-issues` against an `httptest` GitHub: epics, Tickets with their labels, milestones, sub-issues and blocked-by, in dependency order; a second run creates nothing new.
- [ ] Each created Ticket's `ideaId` is the Conception's Idée; the Conception is « Terminée ».
- [ ] A creation interrupted after 3 of 6 Tickets, rerun, ends with exactly 6.

## Verification

- `cd apps/runner && go test ./internal/contrat/... -run Split && go test ./internal/github/`
- `pnpm exec nx test contracts -- src/contrats/split.spec.ts`
- `pnpm exec nx test server -- src/designs/split.spec.ts`
- `pnpm exec nx test-integration server -- designs`
- `pnpm exec nx run contracts:generate` with no diff; `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The review page of the proposed Tickets and its approval: CONCEPTION-10.
- Re-splitting the stories changed by an amended PRD (`reprend`): not at the MVP.

## Dependencies

- CONCEPTION-4.
- BOUCLE-1.
