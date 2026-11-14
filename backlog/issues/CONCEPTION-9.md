---
id: CONCEPTION-9
title: "Découpage Étape: the split kind handler, the official plan-backlog Skill writing Tickets at their Source, and its Contrat"
epic: CONCEPTION
type: feature
priority: P0
size: M
milestone: M6 Conception
blocked_by: [CONCEPTION-4, BOUCLE-1, MIROIR-7]
adr: [0002, 0004, 0005, 0011, 0012]
risques: [IA-6]
stories: [US-12, US-48]
screens: []
revue_visuelle: false
video: false
reprend: 80
---

## Context

US-12: an approved Conception is split into Tickets the Pilote validates in one pass. The refonte (PRD #169, ADRs 0011 and 0012) changes where those Tickets live: no backlog files committed in a design PR and created as GitHub issues after approval, but Tickets written **at the Projet's Tickets' Source** (Local `tickets/<n>-<slug>.md`, or GitHub issues) by the agent through `crewdeck-runner miroir issue create` (MIROIR-7), not ready, then made ready by the « Validation des Tickets » gate (CONCEPTION-10), as an Idée's drafted Ticket is (US-56, IDEE-5). The Étape is the `split` **kind handler** of PROCESS-4's engine (« Découpage en Tickets »: Entrées PRD, Maquettes, Conception technique; Sortie Ticket), its Rôle, Skill and Serveurs MCP being its Outils; its Contrat reads the Tickets through the Miroir's view, one Contrat whatever the Source (ADR 0012, « The agents' one channel »). The Skill is ported from the dotfiles `plan-backlog` skill, full-pass mode (`MaximeD1412/dotfiles`, `agents/skills/plan-backlog/SKILL.md`, `REFERENCE.md`, `ISSUE-TEMPLATE.md`, `scripts/check-backlog.mjs`). PILOTAGE-3's lead time needs every Ticket linked to the Conception's Idée.

## Current state of the code

- `STEP_IDS` has `split`; no Contrat nor Skill for it on develop.
- Created by CONCEPTION-3 / CONCEPTION-4: the document handlers, the remarks format and `remarks-answered`, the `approval` gate, `ticket-comments.ts` writing a comment on a Ticket for either Source.
- Created by IDEE-5 (M5): `apps/runner/internal/contrat/checks/ticket_body.go` (a Ticket body's sections and criteria), the checks' Miroir reader, `linkTicketToIdea(tx, projectId, number, ideaId, phaseRunId)`, `Ticket.ideaId` and `Ticket.originPhaseRunId`; written here under the same names if IDEE-5 is not merged.
- Created by BOUCLE-1: `tickets` (`source`, number, state, `ready`, labels, `blockedBy`, `parent`, sealed title for Local) and the `tickets` upsert hook; by SOURCE-3: the Local rows from `local.changed` with their `contentHash`.
- Created by MIROIR-6 / MIROIR-7: `miroir issue view|list|search` and `issue create|edit|comment` for both Sources (GitHub with the Session's token then refresh; Local the Ticket file in the folder's working tree, never committed).
- Created by PROCESS-4 / PROCESS-5: kind handlers, outputs, an Entrée « absente », an arrow into a « pour chaque » Phase turning each Ticket into an item.

## To do

- **Kind handler** `apps/server/src/process/engine/kinds/split.ts` (kind `split`), domain `apps/server/src/designs/split.ts`:
  - `start(tx, stepRun)`: RUNNER-12's agent Session with its `role`, `skill` and `mcp` Outils and the Contrat `split`, in a worktree of the integration branch at the latest approved document's SHA; arguments `{ prdPath, mockups: <change number> | 'absent', technicalDesign: <change number> | 'absent', designId, iteration }`.
  - On `passed` with `step.report { figures: { tickets: [{ id, number }], epics: [{ id, number }], ticketCount } }`: one output per Ticket `{ portId: <its ticket Sortie>, type: 'ticket', id: number }` (epics apart, not outputs); each number linked with `linkTicketToIdea` (the Conception's Idée, the Conception's PhaseRun); `design.upserted`.
  - A Ticket of its outputs changed at its Source while the gate after it waits (the `tickets` upsert hook: a GitHub `issues.edited` changing title or body, a Local `contentHash` that differs, a closed one) signals `document-voided` to that gate and sends CONCEPTION-3's `step.check` of this StepRun; a passing re-check signals `document-refreshed`.
- **Skill** `apps/runner/skills/plan-backlog/` (`SKILL.md`, `REFERENCE.md`, `ISSUE-TEMPLATE.md`), ported for a full pass of one PRD file:
  - frame the epics and milestones, the decomposition table validated in one closed round (`AskUserQuestion`), each Ticket written with the template (current state read from the code, never from memory), `docs/pilotage/risques.json`'s `tickets` left to the Projet;
  - write at the Tickets' Source with `crewdeck-runner miroir issue create`: one Ticket per epic, then each Ticket in dependency order, its body ending with the hidden marker `<!-- crewdeck:ticket <ID> -->`, labels `epic:<x>`, `type:<type>`, `priority:<P>`, `size:<S>`, `revue-visuelle` when it has screens, never `ready-for-agent`; its epic as parent and its blockers with MIROIR-7's `--parent` and `--blocked-by` flags (added to MIROIR-7's `issue create|edit` here if it has none: sub-issues and blocked-by on GitHub, `parent` and `blocked_by` of the front matter on Local); `--milestone` only for a milestone the Source already has;
  - idempotent: a Ticket whose marker already exists at the Source (`miroir search`, both Sources) is edited (`miroir issue edit`), never created twice;
  - `.crewdeck/report.json` lists `{ id, number }` per Ticket and epic; then `crewdeck-runner etape report`;
  - settle mode (`iteration` > 1): the remarks are comments on the Tickets (CONCEPTION-10, one per Ticket with remarks, CONCEPTION-3's format); the Skill edits each Ticket and answers on it with `miroir issue comment`.
  - Dropped: `design start/done`, `create-issues.py`, `backlog/` files and `issues-map.json`, the GitHub Project board (Crewdeck's planning replaces it), single-ticket mode (IDEE-5's `idea-ticket`), `reprend`.
- **Contrat** `packages/contracts/src/contrats/split.ts`, version 1, the rules of `check-backlog.mjs` ported to Go `check` functions in `apps/runner/internal/contrat/checks/backlog_*.go`, reading the Tickets of `.crewdeck/report.json` through the Miroir's view (one parser `backlog_view.go` over `ticket_body.go`):
  - `split.tickets.draft` (`backlog-draft`, bloquant): each Ticket and epic exists at the Tickets' Source, open, not ready, with its marker, « Chaque Ticket est écrit à sa Source, sans être prêt pour la Boucle »;
  - `split.labels` (`backlog-labels`, bloquant): `type`, `priority`, `size` valid, one `epic:` label whose epic Ticket exists and is its parent, « Chaque Ticket a son type, sa priorité, sa taille et son epic »;
  - `split.sections` (`backlog-sections`, bloquant): the template's sections in the backlog's language, `Reproduction` for a `fix`, « Chaque Ticket a les sections du modèle »;
  - `split.criteria` (`backlog-criteria`, bloquant): at least one `- [ ]` under the acceptance criteria, « Chaque Ticket a au moins un critère d'acceptation »;
  - `split.graph` (`backlog-graph`, bloquant): no blocker outside the Source, no cycle, no blocker in a later milestone, « Les dépendances sont connues, sans cycle ni jalon plus tardif »;
  - `split.references` (`backlog-references`, bloquant): cited ADRs, risks, stories (not removed) and screens exist in the worktree, « Chaque story, écran, ADR et risque cité existe »;
  - `split.coverage` (`backlog-coverage`, attention): every `MVP` story and every screen of the PRD file is cited by a Ticket, « Chaque story MVP et chaque écran a un Ticket »;
  - `split.remarks.answered` (`check` `remarks-answered` on each Ticket's latest remarks comment), « Chaque remarque est corrigée ou non retenue avec sa raison ».
  - The failed rules name the Tickets in the verdict's details on the Runner's side only (the server gets rule ids); fixtures passing and failing per rule for a Local folder and a recorded GitHub copy.

## Decisions already made

- The Tickets are written at their Source before the Pilote validates them, not ready: the Contrat checks what the Boucle will read, through the same Miroir, and validating only makes them ready (CONCEPTION-10). The Boucle never takes them before (BOUCLE-2 admits ready Tickets only).
- The agent writes the Tickets with the Session's token through the Miroir, never the server (ADR 0002, ADR 0012): bodies are content. On Local they land in the folder's working tree, never committed (ADR 0012).
- The hidden marker gives the idempotence across Retours and reruns, on both Sources, without any committed map.
- No GitHub Project board and no milestone created: the Projet's planning (PILOTAGE-1) and ticket tree (PILOTAGE-2) are Crewdeck's, and milestones are the Source's.
- `split.coverage` is `attention`: a split that leaves a story for later still passes, the Pilote sees it in the review.

## Acceptance criteria

- [ ] After the approval of the technical design on « Process Crewdeck », the `split` Étape starts; on a GitHub Projet the fake Runner's Session creates two epics and six Tickets as issues without `ready-for-agent`, with their labels, parents and blockers; a passing report gives one output per Ticket.
- [ ] On a Local Projet the same Session writes eight `tickets/<n>-<slug>.md` files with `ready: false`, their `parent` and `blocked_by`; no GitHub call is made.
- [ ] A Ticket without acceptance criteria fails `split.criteria`; a cycle fails `split.graph`; an unknown story fails `split.references`; a ready Ticket fails `split.tickets.draft`; a missing MVP story only warns (`split.coverage` attention) — Go fixtures on both Sources.
- [ ] A rerun after a Retour edits the same Tickets (found by their marker): a split interrupted after 3 of 6 Tickets, rerun, ends with exactly 6.
- [ ] Each Ticket's `ideaId` is the Conception's Idée and its `originPhaseRunId` the Conception's PhaseRun.
- [ ] A Ticket edited at its Source while the gate waits voids the gate's Décision and re-checks the Contrat.

## Verification

- `cd apps/runner && go test ./internal/contrat/... -run Split`
- `pnpm exec nx test contracts -- src/contrats/split.spec.ts`
- `pnpm exec nx test server -- src/designs/split.spec.ts src/process/engine/kinds/split.spec.ts`
- `pnpm exec nx test-integration server -- designs`
- `pnpm exec nx run contracts:generate` with no diff; `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing (the Skill ships in the Runner's release).

## Out of scope

- The review page of the proposed Tickets and making them ready: CONCEPTION-10.
- The agents' writes to either Source: MIROIR-7. Admitting the ready Tickets into the « Développement » Phase: BOUCLE-2.
- Re-splitting the stories changed by an amended PRD (`reprend`): not at the MVP.

## Dependencies

- CONCEPTION-4.
- BOUCLE-1.
- MIROIR-7.
