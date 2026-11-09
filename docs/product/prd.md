# Crewdeck — PRD

> Ideas: DCCM-IDEA#29. Approved: <PR link> (<date>).

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

## Users

| Role | Who | What they come for |
|---|---|---|
| **Pilote** | A solo developer with a GitHub account and their own Claude or Codex account, driving several Projets with agents; the first one is the founder | Follow Idées, Conceptions, Tickets and agents in real time, and decide at the Process's gates, from the PC or the phone |
| **Visiteur** | Someone who discovers Crewdeck before signing up | Understand what the product does in five minutes, without connecting anything |
| **Moddeur** | A **Pilote** who writes their own **Skin** with the SDK, or their own **Skill** for an **Étape** | Change the look of the product, or how its agents work, a little or completely, while keeping its logic and its gates |

## Principles

- **The Process is the product.** Idée → Conception → Tickets → Boucle,
  with their gates: the stages and gates are ours, the same for every **Pilote**.
- **Every outside tool is behind a Connecteur.** The Process knows what a
  module needs (a code host, a ticket tracker, a design tool, a channel),
  never a brand: GitHub, Figma or Slack can be swapped for another tool or
  an MCP server the Pilote chooses.
- **Real time.** A change on GitHub or from an agent is on screen in under
  2 s.
- **The frame of the Process is ours, the method can be yours.** Each
  **Étape** has a **Contrat** (what it must produce) and its gates, kept by
  the core; the **Skill** that does the work can be replaced, never the
  **Contrat** nor the gates. The **Étapes optionnelles** can be
  turned off per **Projet**; the others always run.
- **The core keeps the logic, the Skin only draws.** Everything on screen is
  a **Composant** a **Skin** may replace; a **Composant** gets its data and
  actions from the core and never decides alone.
- **An Action sensible is always confirmed by the core** (merge, start the
  Boucle, approve a document of a Conception — PRD, mockups, technical
  design, Tickets — approve the inventory of an existing repository, and
  later release), whatever the **Skin**. Starting the **Boucle**, or
  creating or resuming its **Planification**, is the one confirmation that
  covers its own work: the merges of the Tickets that pass their review,
  until it is stopped (or the **Planification** paused or deleted).
- **The code, the agents and the AI accounts stay with the Pilote.** Agents
  run on the **Pilote**'s machine through the **Runner**, on the official
  agent programs the **Pilote** signs in to themselves, with their own
  **Comptes IA**; the product never holds an AI credential.
  Conversations, code and diffs travel encrypted end to end between the
  **Runner** and the **Pilote**'s browser; our servers keep only the state
  of the **Process** (titles, states, **Décisions**).
- **Everything that waits for the Pilote is in « À toi »**, with a
  notification when they are away; every default screen works at 390 px.

## Journeys

### Getting started
A developer signs up with GitHub, installs the **Runner** on their machine,
connects their AI accounts and picks the repositories to follow; the product
prepares them for the **Process**. Getting started ends only once at least
one **Moteur** can run; the exact commands of the **Runner** are the
technical design's.
- **US-1** (MVP) As a Pilote, I want to sign up with my GitHub account, so that I do not create yet another password.
- **US-2** (MVP) As a Pilote, I want to install the Runner on Linux, macOS or Windows (WSL) with one command and link it to my account, a failed link saying why and giving the command again, so that agents run on my machine with my own Comptes IA.
- **US-3** (MVP) As a Pilote, I want to pick the GitHub repositories the product follows, so that each one is prepared for the Process (labels, branches, configuration) without manual setup.
- **US-4** (MVP) As a Pilote, I want to see for each Projet what is still missing to run the Process (the Runner linked, a usable Moteur for each Rôle, the labels, the integration and release branches, the Process's settings in the repository, and for an existing repository its approved inventory), the product fixing in the repository what it can on one click of mine, each fix visible on GitHub, so that I know what to fix before the agents start.
- **US-68** (MVP) As a Pilote, I want to bring in a repository that already has code, the product drafting its glossary, its technical choices and an inventory, which a Décision in « À toi » asks me to approve at once or to send back with my changes, what I approve being written to the repository visibly on GitHub, so that an existing project gets the same Process as a new one.
- **US-70** (next) As a Pilote, I want to install the Runner on a server of mine with no screen (a VPS, a home server), so that agents work when my PC is off.
- **US-80** (next) As a Visiteur, I want a demonstration Projet already filled (Idées, a PRD, a Boucle at work, Décisions), so that I understand Crewdeck in five minutes without connecting my repositories.
- **US-38** (MVP) As a Pilote, I want to connect my Comptes IA on my Runner (my Claude or Codex sign-in where the provider allows it, else my API key) and see which Moteurs and models I can really use, and why one is not (connexion requise, quota atteint, indisponible avec cet abonnement), getting started needing at least one usable Moteur, so that I never pick an agent that cannot run.

### Idées
The Pilote notes an Idée from anywhere; an analysis qualifies it and they
triage it.
- **US-5** (MVP) As a Pilote, I want to note an Idée in one sentence from the PC or the phone, choosing its Projet if I want to, so that nothing is lost.
- **US-6** (MVP) As a Pilote, I want each Idée analysed (summary, target Projet, which I can correct, impact, effort, possible duplicates), so that I triage in seconds.
- **US-7** (MVP) As a Pilote, I want to retain, merge or reject an Idée, so that only what is worth it goes to Conception.
- **US-56** (MVP) As a Pilote, I want to turn an Idée straight into a Ticket, without a Conception, when it is a small fix, the agent of the Rôle Idée drafting the Ticket from the Idée and its analysis and I validating it like the Tickets of a Conception, or sending it back with a comment the agent takes up, the validated Ticket joining the ready Tickets of its Projet, so that small things do not wait for a PRD.
- **US-57** (MVP) As a Pilote, I want to dictate an Idée or a message to an agent, on the PC or the phone, the transcript filling the field so that I correct it before sending, so that I capture and answer without typing.
- **US-91** (MVP) As a Pilote, I want to put a merged or rejected Idée back to triage, keeping its analysis, which I can run again, so that a wrong click is never final.

### Conception
A retained Idée goes through product design, mockups and technical design,
each one a conversation with an agent, each one approved by the Pilote. The
cross review (an Étape optionnelle) reads the PRD and the technical design,
each just before the Pilote approves it.
- **US-8** (MVP) As a Pilote, I want to start the Conception of a retained Idée in one click, so that an agent runs the product design with me.
- **US-9** (MVP) As a Pilote, I want to drive an agent session from the product (read it as it streams, write to it, answer its questions and permission requests, stop and resume it), so that I never need a terminal to talk to an agent.
- **US-10** (MVP) As a Pilote, I want to follow each Conception from the Idée to its Tickets (PRD, mockups, technical design), an Étape optionnelle turned off for its Projet shown as such, so that I know where each one stands.
- **US-11** (MVP) As a Pilote, I want to review a Conception document or a set of mockups and either approve it or ask for changes, so that nothing is built that I did not validate.

### Tickets and the Boucle
An approved Conception becomes Tickets; the Boucle implements them one by
one on the Runner, each through a reviewed PR that it merges itself once the
second agent and the checks pass; it stops for the Pilote only on a visual
review or a blocked Ticket.
- **US-12** (MVP) As a Pilote, I want an approved Conception split into Tickets that I validate in one pass, so that the agents know exactly what to build.
- **US-13** (MVP) As a Pilote, I want to start and stop the Boucle of a Projet, starting it being my explicit consent to background work on my Comptes IA and to the merge of each Ticket that passes its review, until I stop it, so that I decide when my machine and my accounts work.
- **US-62** (MVP) As a Pilote, I want to schedule the Boucle of a Projet (at a time, every night, or when a Compte IA's window resets), creating the Planification, or resuming it after a pause, being confirmed like starting the Boucle and covering each scheduled start and its merges until I pause or delete it, stopping one run leaving the next ones planned, so that agents work when my limits allow it.
- **US-73** (next) As a Pilote, I want to choose the MCP servers the agents of a Projet may use, so that they get the tools that Projet needs and nothing more.
- **US-74** (next) As a Pilote, I want a spending cap per Projet and per month for my API keys, the Boucle stopping with a Décision when it is reached, so that a bill never surprises me.
- **US-14** (MVP) As a Pilote, I want to see which ticket each agent is on and at which step (coding, waiting for checks, in review), so that I know what my agents are doing right now.
- **US-15** (MVP) As a Pilote, I want each Ticket delivered as a PR that a second agent and the checks review, and that the Boucle merges itself once they pass, unless the Ticket needs a visual review or is blocked, the Boucle going on meanwhile with the Tickets that do not depend on it, so that I only look at what needs my eyes.
- **US-16** (MVP) As a Pilote, I want the planning of each Projet (what is next, what is blocked, by what), so that I see when a milestone will be done.
- **US-36** (MVP) As a Pilote, I want to review the captures of a Ticket with a visual review and either approve it, which merges its PR, or ask for changes with a comment that the Boucle takes up, while the Boucle goes on with the Tickets that do not depend on it, so that my review never stops the other work.
- **US-39** (MVP) As a Pilote, I want to choose the Moteur and the model of each Rôle (Idée, Conception, Code, Review) for all my Projets and change it for one Projet, the Review using by default another Moteur than the Code, so that each step runs on the agent I trust for it and the review stays independent.

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
- **US-20** (MVP) As a Pilote, I want a change on GitHub or from an agent on screen in under 2 s, without reloading, so that I can trust what I see.
- **US-21** (MVP) As a Pilote, I want to see « resynchronisation… » after a lost connection until the state is sure again, with the Actions sensibles unavailable until then, so that I never act on a stale state.
- **US-60** (MVP) As a Pilote, I want my conversations, code and diffs to travel encrypted end to end between my Runner and my browser, the product's servers keeping only the state of the Process, a session showing only its title and state while the Runner is offline, interrupted until I resume it once the Runner is back, so that my code never sits on someone else's server.

### Skins
The Pilote chooses how the product looks, in the Marketplace or with a
Thème; a Moddeur reshapes it from one colour to the whole screen, by
replacing Composants.
- **US-22** (next) As a Pilote, I want to choose a Thème (colours, type) for the default Skin, so that the product looks like I want without code.
- **US-23** (MVP) As a Moddeur, I want a documented library of Composants that covers everything on screen, from the Cadre of the page and each item of the menu to whole pages (Idées, « À toi », the Boucle), their blocks (a Ticket's card, an agent session) and the smallest elements (a status badge, a button), each with its data, actions, Emplacements and a preview, in a page of the product reached from the Paramètres, so that I can replace any of them.
- **US-24** (next) As a Moddeur, I want to try my Skin on my account while I write it, so that I see it with my real Projets.
- **US-25** (next) As a Pilote, I want to choose the Skin used on the PC and the one used on the phone, a Skin saying whether it works on the PC, the phone or both, so that each screen gets a Skin made for it.
- **US-26** (MVP) As a Pilote, I want an Action sensible (merge, start the Boucle, approve a document of a Conception or the inventory of a repository) asked by any Skin to be confirmed in a dialog of the product itself, so that no Skin can act behind my back.
- **US-27** (next) As a Pilote, I want the product to fall back to the default Skin with a message when a Skin fails, and a fixed address that always opens the default Skin, so that I am never cut off from my Décisions.
- **US-29** (next) As a Pilote, I want the official isometric open-space Skin, where agents are employees at their desks and Décisions are a HUD, so that following my agents is a pleasure.
- **US-41** (next) As a Moddeur, I want my Skin to start from another Skin and replace only the Composants I choose, the others coming from that parent, so that a small change stays a small Skin.
- **US-42** (next) As a Moddeur, I want to fill, reorder or empty the Emplacements of a Composant (a page's list, a card's badges, the Cadre's menu), so that I can rearrange the screen without rewriting what goes in it.
- **US-43** (next) As a Moddeur, I want each Composant's contract versioned, the product saying which versions my Skin works with and keeping them working across its updates, so that an update of Crewdeck never breaks my Skin.
- **US-44** (next) As a Pilote, I want to browse the Marketplace and install one of its Skins in one click, so that I change the look without writing code.
- **US-45** (next) As a Pilote, I want the official « Terminal » Skin, dense and driven from the keyboard, so that I work fast without the mouse.
- **US-46** (next) As a Moddeur, I want to keep my Skin private to my account, so that I use it without publishing it.

### Skills
Each Étape of the Process is done by a Skill: the official one by default,
later the Pilote's own; the product checks every output against the
Étape's Contrat.
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
- **US-82** (MVP) As a Pilote, I want complete Paramètres for my account (Rôles and models, notifications, Planifications, Étapes optionnelles at the MVP; the Skins, channels and Plafonds join them when the Bêta brings them) and for each Projet, a Projet inheriting my account's Paramètres and changing only what it needs (its Rôles, its Étapes optionnelles, and its notifications, which a Projet can only turn on or off at the MVP), so that I set things once and adapt per Projet.
- **US-83** (MVP) As a Pilote, I want to turn the Étapes optionnelles on or off per Projet (at the MVP the mockups, the visual review and the cross review of a Conception; the visual audit, the user tests and the preview join them with the Bêta), the Idée analysis, the Tickets, the Code, the Review and the checks staying mandatory, so that a Projet without screens does not wait for a visual review.
- **US-84** (next) As a Pilote, I want to show, hide and reorder the Composants of my Skin from the Paramètres, without code, so that I see only what I use.

### Language
- **US-28** (next) As a Pilote, I want the product in French or English, so that I use it in my language.

### Next
- **US-30** (next) As a Pilote, I want the acceptance, release and operations stages (candidate, release button, prod watch), so that the Process goes to prod from the product.
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
- **US-88** (next) As a Pilote, I want to bind each module of a Projet (code host, Idées and Tickets, CI, design, notifications, previews) to the Connecteur of my choice from a catalogue, or to an MCP server of mine, so that Crewdeck works with the tools I already use.
- **US-90** (next) As a Pilote, I want to follow a Projet hosted on GitLab or Gitea instead of GitHub, with the same Process (Tickets, PRs, reviews, checks, merges), so that my code host is my choice.
- **US-64** (next) As a Pilote, I want the architecture plans, the risk register and the release checklist of each Projet, so that I steer it like a project, not only a backlog.
- **US-69** (next) As a Pilote, I want the dependency update PRs (Dependabot) taken up by the Boucle like Tickets, so that dependencies stay up to date without me.
- **US-79** (next) As a Pilote, I want each Skill of the Marketplace rated on its real results (share of outputs that meet the Contrat, share of Tickets merged without a request for changes), so that I choose on facts, not on stars.

### Later
- **US-32** (later) As a Pilote, I want agents to run in the product's cloud instead of my machine, so that they work when my PC is off.
- **US-33** (later) As a Pilote, I want to invite teammates with roles, so that a team drives its Projets together.
- **US-35** (later) As a Pilote, I want to add optional Étapes to the Process of my Projets (a security review after the Code, for instance), each with its Contrat, so that it fits how I work.
- **US-37** (later) As a Pilote, I want to host the product on my own server, so that my Projets' state never leaves my infrastructure.
- **US-47** (later) As a Moddeur, I want to sell my Skin in the Marketplace, the product taking a commission, so that my work pays.
- **US-59** (later) As a Pilote, I want agents to propose what they learnt about a Projet (glossary terms, decisions, notes) as a PR to its repository that I review, so that the next agents start from it and the memory stays versioned.
- **US-89** (later) As a Moddeur, I want to write a Connecteur for a tool and publish it in the Marketplace after review, so that the community connects Crewdeck to any tool.
- **US-81** (later) As a Pilote, I want a new Projet created from a template (web, API, mobile) with its stack, CI and deployment ready, so that a retained Idée becomes a working repository in minutes.

## Scope

| Version | Contains | Done when |
|---|---|---|
| MVP (`MVP`) | US-1 to US-21, US-23, US-26, US-36, US-38 to US-40, US-48, US-55 to US-57, US-60 to US-63, US-68, US-82, US-83, US-91: the founder's own use. One-person account, existing GitHub repositories, **Runner** with the **Pilote**'s **Comptes IA** and a **Moteur** per **Rôle**; Idées (dictated or typed, straight to a Ticket when small), Conception, Tickets, Boucle, « À toi »; limits and **Planifications**; statistics, planning and ticket tree; real time, end-to-end encryption; the default sober **Skin** built on the library of **Composants**; every **Étape** checked against its **Contrat**; **Paramètres** and **Étapes optionnelles** | the founder drives the Process of all their projects, from the Idée to the merged PR, with Crewdeck instead of the dotfiles console for 4 weeks |
| Bêta (`next`) | US-22, US-24, US-25, US-27 to US-29, US-41 to US-46, US-65 to US-67, US-70 to US-78, US-80, US-84: what external testers need. **Thèmes**, **Skins** (inheritance, **Emplacements**, versioned contracts), the **Marketplace** with the isometric and « Terminal » **Skins**, private **Skins**; French and English; client feedback, reports and **Lien de suivi**, **Journal des Décisions**; user tests, visual audit, previews; **Runner** on a server; Slack, Discord, Telegram; MCP servers; **Plafonds**; the demonstration **Projet** | 5 external beta testers are active every week; the three official **Skins** use the public library only |
| Lancement (`next`) | US-30, US-31, US-34, US-49 to US-54, US-58, US-64, US-69, US-79, US-85 to US-88, US-90: acceptance, release and operations, a paid plan, third-party **Skins** and **Skills** after review, the **Pilote**'s own **Skills**, parallel **Boucles**, progression, architecture and risks, dependency PRs, **Skill** ratings, design tools (Penpot, Pencil, Figma), more **Moteurs** and own models, **Connecteurs** for every module (GitLab and Gitea included) | a first paying **Pilote**; a first **Skin** and a first **Skill** published by someone outside the team |
| later | US-32, US-33, US-35, US-37, US-47, US-59, US-81, US-89: agents in our cloud, teams, optional **Étapes** added to the **Process**, self-hosting, paid **Skins**, agents' learnings by PR, project templates, third-party **Connecteurs** | — |

**Out**:
- Reselling AI usage: the **Pilote** brings their own **Comptes IA**.
- A free-form Process, without its **Étapes**, **Contrats** or gates: the
  Process is the product, and agents without a process is what the
  competitors already offer; a **Pilote** changes the method (**Skills**),
  not the frame.
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
  release and operations stay in the console until the Lancement.
- Bêta: 5 external beta testers are active every week (at least one ticket
  merged by the Boucle per week each), measured by the product's usage.
- A change on GitHub or from an agent is visible in under 2 s (p95),
  measured from the event to the screen.
- Bêta: the three official **Skins** are built with the public library of
  **Composants** only, with no private access to the core, checked at the
  Bêta's review.

## Constraints

- GitHub is the only code host of the MVP and the Bêta; it is a
  **Connecteur** like the others, GitLab and Gitea come at the Lancement
  (US-90).
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
