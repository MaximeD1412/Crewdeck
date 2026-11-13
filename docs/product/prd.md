# Crewdeck — PRD

> Ideas: DCCM-IDEA#29, #30. Approved: <PR link> (<date>). Features:
> [Gestion du process](features/gestion-du-process.md).

## Problem

- A solo developer who drives several Projets with AI agents (Claude Code,
  Codex) juggles GitHub, terminals and chat apps to know what each agent is
  doing and what waits for them.
- The state they see lags behind: a merged PR, a failed check or an agent
  waiting for a Décision shows up minutes later, or not at all.
- The agent workspaces that exist (Paradev, Shuriken, VibeiDE, T3 Code, as of
  2026-11-08) run and show agents, but none takes a Projet from the Idée
  through a validated Conception and Tickets to the merged PR, with the
  Pilote's gates in one place.
- They impose one interface, or let you change it only by forking their code;
  a developer cannot shape the view of their own work (from a sober dashboard
  to a game-like office) and keep the product's updates.
- They impose one process and one stack of tools, GitHub first. A developer
  whose project lives in a folder of Markdown files on their machine, or one
  whose team tickets in Jira, documents in Confluence and deploys to
  Kubernetes, cannot make their agents follow the process they actually run.
- Workflow builders (n8n and the like) compose anything, but know nothing of
  a software project: nothing checks that a step gets what it needs, nor that
  a change is reviewed before it ships.

## Users

| Role | Who | What they come for |
|---|---|---|
| **Pilote** | A solo developer with their own machine and their own Claude or Codex account, driving several Projets with agents, with the tools they choose (GitHub or none, a ticket tracker, a documentation tool); the first one is the founder | Compose the Process of each Projet, follow Idées, Conceptions, Tickets and agents in real time, and decide at the Process's gates, from the PC or the phone |
| **Visiteur** | Someone who discovers Crewdeck before signing up | Understand what the product does in five minutes, without connecting anything |
| **Moddeur** | A **Pilote** who writes their own **Skin** with the SDK, or their own **Skill** for an **Étape** | Change the look of the product, or how its agents work, a little or completely, while keeping its logic and its gates |

## Principles

- **Your Process, our guard-rails.** The **Pilote** composes the **Process**
  of each **Projet** on a canvas, as n8n composes a workflow, from a
  **Modèle de process** (« Process Crewdeck » by default: Idée → Conception
  → Tickets → Boucle). Every **Étape** declares what it consumes and
  produces and has its **Contrat**, kept by the core; the product checks
  every arrow and keeps the gates. Before any merge, the checks and a
  **Review** always run: the Review can run on any **Rôle**, never be
  removed. The **Skill** that does the work can be replaced, never the
  **Contrat** nor the gates
  ([Gestion du process](features/gestion-du-process.md)).
- **Nothing depends on GitHub by principle.** Every outside tool is behind a
  **Connecteur**; a **Projet** may connect none, its folder on the
  **Pilote**'s machine then holding everything. The only limit is the
  **Connecteurs** not written yet; meanwhile an agent reaches any tool
  through a **Serveur MCP** or a **Commande**.
- **One Source per artefact.** Each **Type d'artefact** of a **Projet**
  (its Tickets, its documents, its mockups) lives in one **Source**; the
  other tools that carry it hold **Copies**, written one way from it. The
  product never merges two places.
- **Real time.** A change at a **Source** or from an agent is on screen in
  under 2 s.
- **The core keeps the logic, the Skin only draws.** Everything on screen is
  a **Composant** a **Skin** may replace; a **Composant** gets its data and
  actions from the core and never decides alone.
- **An Action sensible is always confirmed by the core** (merge, start the
  Boucle, approve a document of a Conception — PRD, mockups, technical
  design, Tickets — approve the inventory of an existing repository,
  activate a changed **Process**, move a **Type d'artefact** to another
  **Source**, and later release), whatever the **Skin**. Starting the **Boucle**, or
  creating or resuming its **Planification**, is the one confirmation that
  covers its own work: the merges of the Tickets that pass their review,
  until it is stopped (or the **Planification** paused or deleted).
- **The code, the agents and the AI accounts stay with the Pilote.** Agents
  run on the **Pilote**'s machine through the **Runner**, on the official
  agent programs the **Pilote** signs in to themselves, with their own
  **Comptes IA**; the product never holds an AI credential, nor the secrets
  of a **Serveur MCP** or a **Commande**. Conversations, code and diffs
  travel encrypted end to end between the **Runner** and the **Pilote**'s
  browser; our servers keep only the state of the **Process** (states,
  **Décisions**, and the titles GitHub already shows them; any other title is
  encrypted).
- **Everything that waits for the Pilote is in « À toi »**, with a
  notification when they are away; every default screen works at 390 px.

## Journeys

### Getting started
A developer signs up, installs the **Runner** on their machine, connects
their AI accounts and creates their **Projets**, from a folder of the machine
or a GitHub repository; the product prepares each one for its **Process**.
Getting started ends only once at least one **Moteur** can run; the exact
commands of the **Runner** are the technical design's.
- **US-1** (MVP) As a Pilote, I want to sign up with a link sent to my email, or with my GitHub or Google account, so that I do not create yet another password and need no GitHub account.
- **US-2** (MVP) As a Pilote, I want to install the Runner on Linux, macOS or Windows (WSL) with one command and link it to my account, a failed link saying why and giving the command again, so that agents run on my machine with my own Comptes IA.
- **US-3** (MVP) As a Pilote, I want to create a Projet from a folder of my Runner's machine or from a GitHub repository, choosing the Modèle de process it starts from, so that each one is prepared for its Process (for GitHub: labels, branches, configuration) without manual setup.
- **US-4** (MVP) As a Pilote, I want to see for each Projet what is still missing to run its Process (the Runner linked, a usable Moteur for each Rôle its Étapes use, the Connecteurs, Serveurs MCP and Commandes it names ready, the Manques of its canvas, for GitHub the labels and the integration and release branches, and for an existing code base its approved inventory), the product fixing what it can on one click of mine, each fix visible where it is made, so that I know what to fix before the agents start.
- **US-68** (MVP) As a Pilote, I want to bring in a folder or a repository that already has code, the product drafting its glossary, its technical choices and an inventory, which a Décision in « À toi » asks me to approve at once or to send back with my changes, what I approve being written to the Source of its documents (its folder, or its repository visibly on GitHub), so that an existing project gets the same Process as a new one.
- **US-70** (next) As a Pilote, I want to install the Runner on a server of mine with no screen (a VPS, a home server), so that agents work when my PC is off.
- **US-80** (next) As a Visiteur, I want a demonstration Projet already filled (Idées, a PRD, a Boucle at work, Décisions), so that I understand Crewdeck in five minutes without connecting my repositories.
- **US-38** (MVP) As a Pilote, I want to connect my Comptes IA on my Runner (my Claude or Codex sign-in where the provider allows it, else my API key) and see which Moteurs and models I can really use, and why one is not (connexion requise, quota atteint, indisponible avec cet abonnement), getting started needing at least one usable Moteur, so that I never pick an agent that cannot run.

### Idées
The Pilote notes an Idée from anywhere; an analysis qualifies it and they
triage it.
- **US-5** (MVP) As a Pilote, I want to note an Idée in one sentence from the PC or the phone, choosing its Projet if I want to, so that nothing is lost.
- **US-6** (MVP) As a Pilote, I want each Idée analysed (summary, target Projet, which I can correct, impact, effort, possible duplicates), so that I triage in seconds.
- **US-7** (MVP) As a Pilote, I want to retain, merge or reject an Idée, so that only what is worth it goes to Conception.
- **US-56** (MVP) As a Pilote, I want to turn an Idée straight into a Ticket, without a Conception, when it is a small fix, the agent of the Rôle Idée drafting the Ticket from the Idée and its analysis and I validating it like the Tickets of a Conception, or sending it back with a comment the agent takes up, the validated Ticket joining the ready Tickets at the Source of its Projet's Tickets, so that small things do not wait for a PRD.
- **US-57** (MVP) As a Pilote, I want to dictate an Idée or a message to an agent, on the PC or the phone, the transcript filling the field so that I correct it before sending, so that I capture and answer without typing.
- **US-91** (MVP) As a Pilote, I want to put a merged or rejected Idée back to triage, keeping its analysis, which I can run again, so that a wrong click is never final.

### Conception
In the default Modèle de process, a retained Idée goes through product
design, mockups and technical design, each one a conversation with an agent,
each one approved by the Pilote. The cross review reads the PRD and the
technical design, each just before the Pilote approves it. A Projet's
Process may add, remove or replace these Étapes.
- **US-8** (MVP) As a Pilote, I want to start the Conception of a retained Idée in one click, so that an agent runs the product design with me.
- **US-9** (MVP) As a Pilote, I want to drive an agent session from the product (read it as it streams, write to it, answer its questions and permission requests, stop and resume it), so that I never need a terminal to talk to an agent.
- **US-10** (MVP) As a Pilote, I want to follow each Conception from the Idée to its Tickets through the Étapes its Projet's Process gives it (PRD, mockups, technical design in the default Modèle), so that I know where each one stands.
- **US-11** (MVP) As a Pilote, I want to review a Conception document or a set of mockups and either approve it or ask for changes, so that nothing is built that I did not validate.

### Tickets and the Boucle
An approved Conception becomes Tickets; the Boucle implements them one by
one on the Runner, each through a reviewed change of code (a PR on GitHub, a
branch on a local Projet) that it merges itself once the Review and the
checks pass; it stops for the Pilote only on a visual review or a blocked
Ticket.
- **US-12** (MVP) As a Pilote, I want an approved Conception split into Tickets that I validate in one pass, so that the agents know exactly what to build.
- **US-13** (MVP) As a Pilote, I want to start and stop the Boucle of a Projet, starting it being my explicit consent to background work on my Comptes IA and to the merge of each Ticket that passes its review, until I stop it, so that I decide when my machine and my accounts work.
- **US-62** (MVP) As a Pilote, I want to schedule the Boucle of a Projet (at a time, every night, or when a Compte IA's window resets), creating the Planification, or resuming it after a pause, being confirmed like starting the Boucle and covering each scheduled start and its merges until I pause or delete it, stopping one run leaving the next ones planned, so that agents work when my limits allow it.
- **US-73** (MVP) As a Pilote, I want to declare Serveurs MCP on my Runner, their secrets staying there, and attach them to the Étapes whose agents may use them, so that each agent gets the tools its Étape needs (Stitch, Figma, a database) and nothing more.
- **US-74** (next) As a Pilote, I want a spending cap per Projet and per month for my API keys, the Boucle stopping with a Décision when it is reached, so that a bill never surprises me.
- **US-14** (MVP) As a Pilote, I want to see which ticket each agent is on and at which step (coding, waiting for checks, in review), so that I know what my agents are doing right now.
- **US-15** (MVP) As a Pilote, I want each Ticket delivered as a change of code (a PR on GitHub, a branch on a local Projet) that the Review and the checks judge, and that the Boucle merges itself once they pass, unless the Ticket needs a visual review or is blocked, the Boucle going on meanwhile with the Tickets that do not depend on it, so that I only look at what needs my eyes.
- **US-16** (MVP) As a Pilote, I want the planning of each Projet (what is next, what is blocked, by what), so that I see when a milestone will be done.
- **US-36** (MVP) As a Pilote, I want to review the captures of a Ticket with a visual review and either approve it, which merges its change of code, or ask for changes with a comment that the Boucle takes up, while the Boucle goes on with the Tickets that do not depend on it, so that my review never stops the other work.
- **US-39** (MVP) As a Pilote, I want to choose the Moteur and the model of each Rôle (Idée, Conception, Code and Review by default, and the Rôles I add, such as a review by Gemini) for all my Projets and change it for one Projet, each agent Étape naming its Rôle, the Review using by default another Moteur than the Code, so that each Étape runs on the agent I trust for it and the review stays independent.

### « À toi »
Everything that waits for the Pilote is in one place, with a notification
when they are away.
- **US-17** (MVP) As a Pilote, I want every Décision that waits for me (a blocked Ticket, a Conception to review, a visual review, an interrupted Ticket, an agent's question or permission request in a session, an inventory to approve) in « À toi », so that I never look for them.
- **US-18** (MVP) As a Pilote, I want a notification on my phone when a Décision waits and I am away (no Crewdeck tab visible for 2 minutes), so that the agents do not stay stuck for hours.
- **US-19** (MVP) As a Pilote, I want to see « Runner hors ligne » in « À toi », one Décision listing the Projets whose work waits, with a notification, when work waits and my Runner is off, so that I do not believe agents are working when nothing runs.
- **US-71** (next) As a Pilote, I want my Décisions in Slack, Discord or Telegram, and to answer them there, so that I decide from where I already am.
- **US-40** (MVP) As a Pilote, I want a Décision in « À toi » when a Ticket stops because a Compte IA reached its limit or got disconnected, saying what to do (wait for the reset, reconnect, switch the Rôle to another Moteur), so that a quota never silently stops the Boucle.
- **US-55** (MVP) As a Pilote, I want to see the usage of each Compte IA against its limits (the 5-hour and weekly windows where the provider has them) and when it will run out at the current pace, and for an API key its estimated spend of the month, so that I start the Boucle when it can finish.

### Real time
What the Pilote sees is the state of now.
- **US-20** (MVP) As a Pilote, I want a change at a Source of my Projets (a file of a Projet's folder, GitHub) or from an agent on screen in under 2 s, without reloading, so that I can trust what I see.
- **US-21** (MVP) As a Pilote, I want to see « resynchronisation… » after a lost connection until the state is sure again, with the Actions sensibles unavailable until then, so that I never act on a stale state.
- **US-60** (MVP) As a Pilote, I want my conversations, code and diffs to travel encrypted end to end between my Runner and my browser, the product's servers keeping only the state of the Process, the titles of what lives only on my machine or in a tool other than GitHub encrypted too, a session or an artefact showing only its title and state while the Runner is offline, a session interrupted until I resume it once the Runner is back, so that my code and my local work never sit readable on someone else's server.

### Skins
The Pilote chooses how the product looks, in the Marketplace or with a
Thème; a Moddeur reshapes it from one colour to the whole screen, by
replacing Composants.
- **US-22** (next) As a Pilote, I want to choose a Thème (colours, type) for the default Skin, so that the product looks like I want without code.
- **US-23** (MVP) As a Moddeur, I want a documented library of Composants that covers everything on screen, from the Cadre of the page and each item of the menu to whole pages (Idées, « À toi », the Boucle), their blocks (a Ticket's card, an agent session) and the smallest elements (a status badge, a button), each with its data, actions, Emplacements and a preview, in a page of the product reached from the Paramètres, so that I can replace any of them.
- **US-24** (next) As a Moddeur, I want to try my Skin on my account while I write it, so that I see it with my real Projets.
- **US-25** (next) As a Pilote, I want to choose the Skin used on the PC and the one used on the phone, a Skin saying whether it works on the PC, the phone or both, so that each screen gets a Skin made for it.
- **US-26** (MVP) As a Pilote, I want an Action sensible (merge, start the Boucle, approve a document of a Conception or the inventory of a repository, activate a changed Process, move a Type d'artefact to another Source) asked by any Skin to be confirmed in a dialog of the product itself, so that no Skin can act behind my back.
- **US-27** (next) As a Pilote, I want the product to fall back to the default Skin with a message when a Skin fails, and a fixed address that always opens the default Skin, so that I am never cut off from my Décisions.
- **US-29** (next) As a Pilote, I want the official isometric open-space Skin, where agents are employees at their desks and Décisions are a HUD, so that following my agents is a pleasure.
- **US-41** (next) As a Moddeur, I want my Skin to start from another Skin and replace only the Composants I choose, the others coming from that parent, so that a small change stays a small Skin.
- **US-42** (next) As a Moddeur, I want to fill, reorder or empty the Emplacements of a Composant (a page's list, a card's badges, the Cadre's menu), so that I can rearrange the screen without rewriting what goes in it.
- **US-43** (next) As a Moddeur, I want each Composant's contract versioned, the product saying which versions my Skin works with and keeping them working across its updates, so that an update of Crewdeck never breaks my Skin.
- **US-44** (next) As a Pilote, I want to browse the Marketplace and install one of its Skins in one click, so that I change the look without writing code.
- **US-45** (next) As a Pilote, I want the official « Terminal » Skin, dense and driven from the keyboard, so that I work fast without the mouse.
- **US-46** (next) As a Moddeur, I want to keep my Skin private to my account, so that I use it without publishing it.

### Skills
Each agent Étape of the Process is done by a Skill: the official one by
default, later the Pilote's own; the product checks every output against the
Étape's Contrat, wherever its Source keeps it.
- **US-48** (MVP) As a Pilote, I want the output of every Étape (an analysed Idée, a PRD, mockups, a technical design, Tickets, a PR, a review) checked against its Contrat, and a Décision in « À toi » to run it again when it is incomplete or fails, an Idée whose analysis failed staying open to triage, so that no Étape passes half done.

### Pilotage and reports
What the Pilote and their clients see of the work, beyond the agents. The
lead time runs from the noting of the Idée to the merge of the last Ticket
it led to; the Boucle's success rate is the share of the Tickets it took
that it merged without the Pilote stepping in; the share of blocked Tickets
counts those blocked at least once among the Tickets taken; the cost per
Ticket is the spend for an API key, and the share of the window used for a
subscription. Spends are estimates in euros, converted from the provider's
bill.
- **US-61** (MVP) As a Pilote, I want the statistics of each Projet and of all of them (lead time from Idée to merge, Boucle success rate, share of blocked Tickets, cost per Ticket), so that I know what the agents really bring.
- **US-63** (MVP) As a Pilote, I want the tree of the open Tickets of a Projet, with what blocks what, next to its planning, so that I see the critical path at a glance.
- **US-65** (next) As a Pilote, I want to paste a client's feedback and get it split into Idées, each analysed and linked to that client, so that no request is lost.
- **US-66** (next) As a Pilote, I want a summary of what was delivered since a date, written for my client in plain words, so that I report without rewriting commits.
- **US-76** (next) As a Pilote, I want a read-only Lien de suivi for a client (planning, progress, what is ready to try), which I can revoke, so that the client sees progress without asking.
- **US-77** (next) As a Pilote, I want a weekly report of all my Projets (delivered, blocked, cost), in the product and by email, so that I keep the big picture.
- **US-78** (next) As a Pilote, I want a searchable Journal des Décisions (every approval, refusal and answer, with its reason and date), so that months later I know why something was done.

### Quality
- **US-67** (next) As a Pilote, I want an agent to test the delivered app as a user would (journeys of the PRD, on the phone and the PC) and report what fails as Idées or Tickets, so that bugs are found before my client finds them.
- **US-72** (next) As a Pilote, I want an automatic visual audit of a Ticket's screens (contrast, states, layout) with a score before its visual review, the Boucle fixing what fails, so that I only review screens that already pass.
- **US-75** (next) As a Pilote, I want a preview address for each PR of a Projet that has a preview deployment, so that I try the change on my phone before I approve it.

### Settings
The Pilote sets their account once, and each Projet differs where it needs.
- **US-82** (MVP) As a Pilote, I want complete Paramètres for my account (Rôles and models, notifications, Planifications, Modèles de process, Serveurs MCP and Commandes at the MVP; the Skins, channels and Plafonds join them when the Bêta brings them) and for each Projet, a Projet inheriting my account's Paramètres and changing only what it needs (its Rôles, and its notifications, which a Projet can only turn on or off at the MVP; its Étapes are its Process's), so that I set things once and adapt per Projet.
- ~~**US-83**~~ removed: the Étapes optionnelles are gone; a Projet's Étapes are added and removed on its canvas (US-93), the Review and the checks staying mandatory before a merge (US-94).
- **US-84** (next) As a Pilote, I want to show, hide and reorder the Composants of my Skin from the Paramètres, without code, so that I see only what I use.

### Language
- **US-28** (next) As a Pilote, I want the product in French or English, so that I use it in my language.

### Next
- **US-30** (next) As a Pilote, I want the Étapes of acceptance, release and operations in the catalogue of the canvas (candidate, release button, prod watch), so that the Process goes to prod from the product.
- **US-31** (next) As a Pilote, I want to subscribe to a paid plan, so that I keep using the product after the beta.
- **US-34** (next) As a Moddeur, I want to publish my Skin in the Marketplace, after the product's review, so that the community shares its Skins.
- **US-49** (next) As a Pilote, I want to import my own Skill (a `SKILL.md`, the format Claude Code and Codex read) for an Étape, for all my Projets or for one, so that the agents work my way while the Process keeps its frame.
- **US-50** (next) As a Pilote, I want to see what a Skill contains (its instructions, its scripts, what it may run) and confirm before it is imported, so that I never run an unknown Skill blindly.
- **US-51** (next) As a Pilote, I want to go back to the official Skill of an Étape in one click, from its settings or from the Décision raised when my Skill missed the Contrat, so that a bad Skill never blocks a Projet.
- **US-52** (next) As a Pilote, I want to find and install Skills in the Marketplace (the official ones, and those of Moddeurs that passed the product's security review), so that I reuse what others made.
- **US-53** (next) As a Moddeur, I want to publish my Skill in the Marketplace after a security review, stricter than a Skin's since a Skill runs on the Pilote's machine, so that others can use it safely.
- **US-54** (next) As a Pilote, I want several Boucles on one Projet at once, each taking Tickets that do not depend on those in progress, within a limit per Moteur, so that independent work goes faster.
- **US-58** (next) As a Pilote, I want a progression (experience earned by the Tickets actually merged, levels, rewards) shown by a Composant any Skin can place, the isometric office growing with it, so that shipping is rewarding.
- **US-85** (next) As a Pilote, I want to connect Penpot, Pencil (pen.dev) or Figma to a Projet, the mockups made there feeding the Conception and each visual review comparing the delivered screens with them, so that I design in my usual tool.
- **US-86** (next) As a Pilote, I want to use the coding agents of the moment as Moteurs, paid or open source (Gemini CLI, OpenCode, Cursor, Copilot, Amp and the next ones), each with the Comptes IA its provider allows, so that I am never locked into two providers.
- **US-87** (next) As a Pilote, I want to add a model of my own (a local model, or any compatible endpoint) to a Moteur that accepts it and give it a Rôle, so that I use open or cheaper models where they are good enough.
- **US-88** (MVP) As a Pilote, I want to choose on the canvas the Source of each Type d'artefact of a Projet (Local or GitHub at the MVP, the other Connecteurs as they come), so that Crewdeck works with the tools I already use.
- **US-90** (next) As a Pilote, I want to follow a Projet hosted on GitLab or Gitea instead of GitHub, with the same Process (Tickets, PRs, reviews, checks, merges), so that my code host is my choice.
- **US-64** (next) As a Pilote, I want the architecture plans, the risk register and the release checklist of each Projet, so that I steer it like a project, not only a backlog.
- **US-69** (next) As a Pilote, I want the dependency update PRs (Dependabot) taken up by the Boucle like Tickets, so that dependencies stay up to date without me.
- **US-79** (next) As a Pilote, I want each Skill of the Marketplace rated on its real results (share of outputs that meet the Contrat, share of Tickets merged without a request for changes), so that I choose on facts, not on stars.

### Later
- **US-32** (later) As a Pilote, I want agents to run in the product's cloud instead of my machine, so that they work when my PC is off.
- **US-33** (later) As a Pilote, I want to invite teammates with roles, so that a team drives its Projets together.
- **US-35** (next) As a Pilote, I want to add Étapes of my own to a Process (a security review after the Code, for instance), with their Skill, their Entrées and Sorties and their Contrat's rules written from the canvas, so that it fits how I work beyond the catalogue.
- **US-37** (later) As a Pilote, I want to host the product on my own server, so that my Projets' state never leaves my infrastructure.
- **US-47** (later) As a Moddeur, I want to sell my Skin in the Marketplace, the product taking a commission, so that my work pays.
- **US-59** (later) As a Pilote, I want agents to propose what they learnt about a Projet (glossary terms, decisions, notes) as a change to the Source of its documents that I review, so that the next agents start from it and the memory stays versioned.
- **US-89** (later) As a Moddeur, I want to write a Connecteur for a tool and publish it in the Marketplace after review, so that the community connects Crewdeck to any tool.
- **US-81** (later) As a Pilote, I want a new Projet created from a template (web, API, mobile) with its stack, CI and deployment ready, so that a retained Idée becomes a working repository in minutes.

## Scope

| Version | Contains | Done when |
|---|---|---|
| MVP (`MVP`) | US-1 to US-21, US-23, US-26, US-36, US-38 to US-40, US-48, US-55 to US-57, US-60 to US-63, US-68, US-73, US-82, US-88, US-91 to US-99, US-102 to US-106: the founder's own use. One-person account, sign-in without GitHub, **Projets** from a local folder or a GitHub repository, **Runner** with the **Pilote**'s **Comptes IA** and their **Rôles**; « Gestion du process »: the canvas, the « Process Crewdeck » **Modèle**, the catalogue's **Étapes**, checked arrows, « pour chaque » and **Retours**, versioned activation; **Sources** Local and GitHub and their migration; **Commandes** (checks and launch of a local **Projet**) and **Serveurs MCP**; Idées (dictated or typed, straight to a Ticket when small), Conception, Tickets, Boucle, « À toi »; limits and **Planifications**; statistics, planning and ticket tree; real time, end-to-end encryption; the default sober **Skin** built on the library of **Composants**; every **Étape** checked against its **Contrat**; **Paramètres** | the success criteria of the MVP below are met |
| Bêta (`next`) | US-22, US-24, US-25, US-27 to US-29, US-41 to US-46, US-65 to US-67, US-70 to US-72, US-74 to US-78, US-80, US-84, US-86, US-100, US-101: what external testers need. **Thèmes**, **Skins** (inheritance, **Emplacements**, versioned contracts), the **Marketplace** with the isometric and « Terminal » **Skins**, private **Skins**; French and English; client feedback, reports and **Lien de suivi**, **Journal des Décisions**; user tests, visual audit, previews; **Runner** on a server; Slack, Discord, Telegram; **Copies** (another tool, or a folder such as an Obsidian vault); more **Moteurs** (Gemini CLI first); **Plafonds**; the demonstration **Projet** | 5 external beta testers are active every week; the three official **Skins** use the public library only |
| Lancement (`next`) | US-30, US-31, US-34, US-35, US-49 to US-54, US-58, US-64, US-69, US-79, US-85, US-87, US-90, US-110: acceptance, release and operations, a paid plan, third-party **Skins** and **Skills** after review, the **Pilote**'s own **Skills** and **Étapes**, parallel **Boucles**, progression, architecture and risks, dependency PRs, **Skill** ratings, design tools (Penpot, Pencil, Figma), own models, **Connecteurs** for ticket trackers and documentation tools (Jira, Confluence and the like) and code hosts (GitLab, Gitea) | a first paying **Pilote**; a first **Skin** and a first **Skill** published by someone outside the team; the second extreme case of [Gestion du process](features/gestion-du-process.md#success-criteria) runs |
| later | US-32, US-33, US-37, US-47, US-59, US-81, US-89, US-107 to US-109: agents in our cloud, teams, self-hosting, paid **Skins**, agents' learnings, project templates, third-party **Connecteurs**, n8n workflows, the **Pilote**'s own **Types d'artefact**, a **Modèle**'s changes offered to its **Projets** | — |

**Out**:
- Reselling AI usage: the **Pilote** brings their own **Comptes IA**.
- A Process without guard-rails: blocks that declare nothing, arrows nobody
  checks, a merge without checks nor **Review**. Agents without a checked
  process is what the competitors and the workflow builders already offer;
  the **Pilote** composes freely within the **Contrats** and the gates.
- Syncing two tools both ways (a ticket edited in Jira and in the Miroir,
  merged): each **Type d'artefact** has one **Source**, the others are
  **Copies**; a two-way merge loses someone's edit silently sooner or later.
- Switching or rotating between several AI accounts to go past a limit
  (offered by some competitors): the providers' terms forbid getting around
  their limits; a quota is a **Décision** (US-40), never a silent switch.
- Offering a Claude.ai or ChatGPT sign-in of our own, or holding AI
  credentials: the providers forbid it; the **Pilote** signs in to the
  official programs on their machine.

## Success criteria

- MVP: the founder drives the Process of all their projects (Idée to merged
  PR) with the product instead of the dotfiles console for 4 consecutive
  weeks, measured by the console's Process pages no longer being used;
  release and operations stay in the console until the Lancement. Until
  then the console stays the founder's tool, in maintenance only: it gets no
  configurable process.
- MVP: one **Projet** with no **Connecteur** at all (a folder of Markdown
  files, a local server) goes from the Idée to a running app launched on the
  machine, with no GitHub account linked to it, measured by that Projet's
  history; and a change made on its canvas (an **Étape** removed, a **Source**
  moved) applies to the next work without restarting anything.
- Bêta: 5 external beta testers are active every week (at least one ticket
  merged by the Boucle per week each), measured by the product's usage.
- A change at a **Source** (a file of a local **Projet**, GitHub) or from an
  agent is visible in under 2 s (p95), measured from the event to the
  screen.
- Bêta: the three official **Skins** are built with the public library of
  **Composants** only, with no private access to the core, checked at the
  Bêta's review.

## Constraints

- Local and GitHub are the only **Sources** of the MVP and the Bêta; GitHub
  is a **Connecteur** like the others, GitLab, Gitea, Jira and Confluence
  come at the Lancement (US-90, US-110). Until then the founder's dotfiles
  console stays their tool (BIZ-4).
- The secrets of a **Serveur MCP**, of a **Commande** and of a **Connecteur**
  that is not GitHub stay on the **Runner**, as the **Comptes IA** do; the
  server never reads what such a **Connecteur** carries (US-60).
- AI providers' terms, read on 2026-11-08 (sources and matrix in
  `docs/research/2026-11-08-ai-providers-and-competitors.md`, added by
  PR #3):
  - Anthropic does not allow a third-party product to offer Claude.ai login
    or route requests through a user's subscription, Agent SDK included,
    unless previously approved; it allows an end user to sign in to the
    unmodified Claude Code binary with their own subscription, under its
    Commercial Terms. API keys are always allowed.
  - OpenAI's Codex app-server sign-in is not allowed for commercial
    services; a ChatGPT plan in a third-party paid app goes through « Sign in
    with ChatGPT », offered to selected partners. API keys are always
    allowed.
  - So the MVP works with API keys for every **Moteur**; a subscription is
    offered only where the provider allows it.
- UI in French at the MVP (the founder's use), French and English from the
  Bêta (US-28).
- Hosted by us (SaaS) in the MVP and next; self-hosting is `later` (US-37).

## Open questions

- Anthropic: may our **Runner** drive the unmodified Claude Code binary,
  signed in by the **Pilote** with their own subscription, in a paid
  product? Written answer asked by the founder (draft in
  `docs/research/provider-letters.md`, added by PR #3), before the beta.
- OpenAI: access to « Sign in with ChatGPT » for Crewdeck, and what must
  stay free to respect its plan-usage terms (which we could not read on
  2026-11-08: the page refused automated access). Asked by the founder,
  before the business model.
- The business model (subscription, free and paid tiers): the founder, after
  the beta testers and OpenAI's answer.
- Demand validation: a sign-up page and 5 interviews, run alongside the
  technical design (ticket `externe`). Conductor, the closest product, stops
  its cloud on 2026-11-20 and its local app in early 2027: the sign-up page
  should be up before then. The interviews also test whether the Skins are
  worth it to a solo developer, the riskiest bet of this PRD.
- Is the name « Crewdeck » free (trademark, domain)? The founder, before the
  sign-up page.
- The questions of [Gestion du process](features/gestion-du-process.md#open-questions)
  (nested Phases, more kinds of Outils, n8n).

## Features

| File | What | Stories |
|---|---|---|
| [features/gestion-du-process.md](features/gestion-du-process.md) | The canvas of the Process, Sources and Copies, Commandes and Serveurs MCP | US-92 to US-110 |
