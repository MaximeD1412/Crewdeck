---
id: BIZ-4
title: "The switchover: drive every Projet with Crewdeck instead of the dotfiles console for 4 consecutive weeks"
epic: BIZ
type: externe
priority: P2
size: S
milestone: M7 Statistics and switchover
blocked_by: [PILOTAGE-3, BOUCLE-8]
adr: []
risques: [AGT-6]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

The MVP is done when « the founder drives the Process of all their projects, from the Idée to the merged PR, with Crewdeck instead of the dotfiles console for 4 weeks » (PRD « Scope »), « measured by the console's Process pages no longer being used; release and operations stay in the console until the Lancement » (PRD « Success criteria »). Risk AGT-6: the console must hold until then. This ticket is that measurement, a gesture of the founder.

## Current state of the code

- Crewdeck's MVP: every ticket of M0 to M7 merged and deployed in production.
- The dotfiles console (`MaximeD1412/dotfiles`, `agents/tools/console/`): its Process pages (Idées, Conceptions, « À toi », Boucle) are what Crewdeck replaces; its release and operations pages stay in use.

## To do

- [ ] Bring every Projet the console follows into Crewdeck (US-3, US-68 for those with code), link the Runner on the founder's machine, connect the Comptes IA.
- [ ] Day 1: stop the console's `agent-loop` and Planifications for these Projets; start their Boucles or Planifications in Crewdeck.
- [ ] For 4 consecutive weeks, use only Crewdeck for Idées, Conceptions, Tickets, « À toi » and the Boucle. Each time the console's Process pages are needed, note why as an Idée in Crewdeck (Projet Crewdeck), and the 4 weeks restart from the next day.
- [ ] Each Friday, a comment here: the week's Tickets merged by Crewdeck's Boucle, the Décisions taken, the returns to the console (with their Idée), Crewdeck's statistics page (US-61) for the week.
- [ ] At the end, a comment « 4 semaines tenues » with the dates, then update `docs/pilotage/risques.json` AGT-6 (closed) in a PR.

## Decisions already made

- Release and operations stay in the console until the Lancement (PRD); using them does not reset the count.

## Acceptance criteria

- [ ] Four consecutive weekly comments with no return to the console's Process pages.

## Verification

- The four weekly comments on this ticket.

## For prod

Nothing.

## Out of scope

- Releases from Crewdeck: US-30 (Lancement).

## Dependencies

- PILOTAGE-3.
- BOUCLE-8.
