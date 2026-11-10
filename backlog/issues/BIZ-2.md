---
id: BIZ-2
title: "Demand validation: a sign-up page outside the repository and 5 interviews, the page up before 2026-11-20"
epic: BIZ
type: externe
priority: P1
size: S
milestone: M0 Skeleton and delivery
blocked_by: [BIZ-1]
adr: []
risques: [BIZ-1, BIZ-3, BIZ-5]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

The PRD's « Open questions »: demand validation is « a sign-up page and 5 interviews, run alongside the technical design (ticket `externe`) ». Conductor, the closest product, stops its cloud on 2026-11-20 and its local app in early 2027 (`docs/research/2026-11-08-ai-providers-and-competitors.md`): the sign-up page should be up before then (risk BIZ-3). The interviews also test whether the Skins are worth it to a solo developer, the PRD's riskiest bet (risk BIZ-1). The page is built by the founder with a hosted tool, outside this repository (decided at the split, 2026-11-10).

## Current state of the code

- Nothing in the repository for the page and none to add: it lives in a hosted form or page tool.
- The pitch to reuse: `README.md` and the PRD's « Problem » and « Principles ».

## To do

- [ ] **Page** (before 2026-11-20), with a hosted tool (Tally, Carrd, Framaforms or similar), in French, served at `inscription.<domain>` (CNAME from BIZ-1):
  - what Crewdeck does in three lines (from `README.md`): the Process from the Idée to the merged PR, in real time, the agents on your own machine and your own Comptes IA, an interface you can reshape;
  - one line for Conductor's users (« ton outil ferme le 20 novembre ? »), without naming another product in a misleading way;
  - an email field, an optional « quels outils d'agents utilises-tu ? » and « accepterais-tu un entretien de 20 min ? »;
  - GDPR: what the email is for (beta invitation, interview), who holds it, how to be removed; no tracking beyond the tool's own counts (risk BIZ-5).
- [ ] Share it where solo developers using agents are (the founder's networks, a few communities); keep a count of sign-ups per week.
- [ ] **5 interviews** of 20–30 min with developers who drive projects with agents: how they follow their agents today, what waits for them and how they learn it, whether they would change the look of their tool, and how much (a colour, a layout, a game-like office), whether they would pay for that. Same script for all five.
- [ ] Write the summary in `docs/research/2026-11-interviews.md` (English; no names or emails, « développeur 1 »…): findings per question, quotes, what it says about the Skins bet; open a PR with it (an agent may write the file from the founder's notes).
- [ ] If the Skins bet looks wrong, open an Idée « revoir la place des Skins » for a `product-design --amend`.
- [ ] Update `docs/pilotage/risques.json` BIZ-1 and BIZ-3 (status, `statutDepuis`) in the same PR.

## Decisions already made

- The page is outside the repository and outside the product's server: no code, no deploy dependency, it can be up in an hour.
- No paid advertising for this validation.

## Acceptance criteria

- [ ] The page is reachable at `inscription.<domain>` on or before 2026-11-20 (or at the tool's own URL if the domain is late, moved to the domain later).
- [ ] Five interviews are done and summarised in `docs/research/2026-11-interviews.md`, merged.

## Verification

- `curl -sI https://inscription.<domain>` returns 200.

## For prod

Nothing.

## Out of scope

- The product's own sign-up (GitHub sign-in): CORE-4. A paid plan: US-31 (Lancement).

## Dependencies

- BIZ-1.
