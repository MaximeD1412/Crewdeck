# AI orchestrators for software projects — 2026-11-19

What the product design of Crewdeck took from a survey of 45 products,
suites and frameworks that drive AI agents through a software project, and
120 capabilities they document. Input:
[the survey](inputs/2026-11-19-orchestrateurs-ia.md), written in French for
the founder from public sources only (nothing installed nor tried). Its
section on Crewdeck was written without the PRD of 2026-11-13 nor the
backlog; this note says what holds.

## 1. What changes in the PRD

- **The Problem.** Some products now take a project from an idea or a
  ticket to a merged PR with human gates (Multica, Spaces, Factory
  Missions). None of them, as far as their documentation goes, checks each
  step's output against a contract, nor runs the whole process on a project
  kept only in a folder of the developer's machine. The PRD's Problem says
  so instead of « none takes a Projet from the Idée to the merged PR ».
- **Conductor.** Its announcement now reads « Plans have changed! We'll
  still be developing Conductor »: only Conductor Cloud shuts down « over
  the next few weeks », with no fixed date (read on 2026-11-19, no update
  date on the page). The PRD's open question said the local app stopped in
  early 2027.

## 2. Already covered by the PRD or the backlog

About 100 of the 120 capabilities: triage, duplicates and impact of an Idée
(US-6); PRD, mockups, technical design and cross review; split into
Tickets, milestones, blocked-by, critical path (US-16, US-63); the whole
« Construction du Process » family (the canvas, Retours with a maximum,
gates, Commandes, Modèles, pinned versions); failed checks, review remarks
and merge conflicts sent back to the agent (the Code Skill's fix modes);
acceptance criteria checked by the Review; merge bound to the judged SHA;
Plafonds, Serveurs MCP per Étape, parallel Boucles, Skill ratings.

## 3. Retained: US-112 to US-123

| Capability (survey) | Seen in | Story |
|---|---|---|
| Detect a stuck agent and escalate | Gas Town, OpenSymphony | US-112 « Session sans progrès » |
| Hand over with the branch's context | Paradev | US-113 « Continuer dans mon terminal » |
| A summary of what moved during a stretch of work | VibeiDE Standup | US-114 « Depuis ta dernière visite » |
| Cost per run, agent or step | Spaces, Multica | US-115 spend per Étape |
| The canvas as the project's state | the survey's remark on Multica and GitLab | US-116 |
| Point at an element of a preview to give an instruction | Shuriken, Vibe Kanban | US-117 zones on a capture |
| Try the app from a dev server or a preview | Intent, Vibe Kanban | US-118 « Essayer » |
| Find a task, document or decision by search | Backlog.md, ClickUp | US-119 search |
| Decisions in local readable files | Backlog.md | US-120 the Journal des Décisions as a Copie |
| Collect requests from Slack or comments | Linear, Tembo | US-121 an Idée from a channel |
| Triage production incidents | Sentry Seer, OpenHands | US-122 a production alert as an Idée |
| A shared specification that evolves during the work | Intent | US-123 the Amendement, behind the Pilote's gate |

## 4. Not retained

- Custom Kanban statuses, cycles: the **Process** is the workflow; one
  person needs no cycles.
- Opportunity mining and custom scores (Productboard, Jira Product
  Discovery): team product management.
- A process described in YAML in the repository: the **Process** lives in
  Crewdeck, versioned (Gestion du process).
- Several repositories per Projet, messages between agents, stacked PRs,
  checkpoints to rewind: costly, for needs the founder does not have.
- Starting an agent by a mention in an issue or Slack: a team's need
  (US-33, later).
- Rotating AI accounts past their limits (Shuriken): out of the PRD, the
  providers' terms forbid it.
