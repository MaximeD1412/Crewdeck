# Crewdeck — PRD

> Ideas: DCCM-IDEA#29. Approved: <PR link> (<date>).

## Problem

- A solo developer who drives several Projets with AI agents (Claude Code,
  Codex) juggles GitHub, terminals and chat apps to know what each agent is
  doing and what waits for them.
- The state they see lags behind: a merged PR, a failed check or an agent
  waiting for a Décision shows up minutes later, or not at all.
- The tools that exist impose one interface; a developer cannot shape the
  view of their own work (from a sober dashboard to a game-like office).

## Users

| Role | Who | What they come for |
|---|---|---|
| **Pilote** | A solo developer with a GitHub account and their own Claude or Codex subscription, driving several Projets with agents; the first one is the founder | Follow Idées, Conceptions, Tickets and agents in real time, and decide at the Process's gates, from the PC or the phone |
| **Moddeur** | A **Pilote** who writes their own **Skin** with the SDK | Change the whole look of the product while keeping its logic |

## Principles

- **The Process is the product.** Idée → Conception → Tickets → Boucle,
  with their gates: the stages and gates are ours, the same for every **Pilote**.
- **Real time.** A change on GitHub or from an agent is on screen in under
  2 s.
- **The core keeps the logic, the Skin only draws.** A **Skin** reads the
  state and asks for actions; it never decides alone.
- **An Action sensible is always confirmed by the core** (merge, start the Boucle, approve a Conception, and
  later release), whatever the **Skin**.
- **The code and the agents stay with the Pilote.** Agents run on the
  **Pilote**'s machine through the **Runner**, with their own AI
  subscriptions.
- **Everything that waits for the Pilote is in « À toi »**, with a
  notification when they are away; every default screen works at 390 px.

## Journeys

### Getting started
A developer signs up with GitHub, installs the **Runner** on their machine
and picks the repositories to follow; the product prepares them for the
**Process**.
- **US-1** (MVP) As a Pilote, I want to sign up with my GitHub account, so that I do not create yet another password.
- **US-2** (MVP) As a Pilote, I want to install the Runner on Linux, macOS or Windows (WSL) with one command and link it to my account, so that agents run on my machine with my own Claude or Codex subscription.
- **US-3** (MVP) As a Pilote, I want to pick the GitHub repositories the product follows, so that each one is prepared for the Process (labels, branches, configuration) without manual setup.
- **US-4** (MVP) As a Pilote, I want to see for each Projet what is still missing to run the Process, so that I know what to fix before the agents start.

### Idées
The Pilote notes an Idée from anywhere; an analysis qualifies it and they
triage it.
- **US-5** (MVP) As a Pilote, I want to note an Idée in one sentence from the PC or the phone, so that nothing is lost.
- **US-6** (MVP) As a Pilote, I want each Idée analysed (summary, target Projet, impact, effort, possible duplicates), so that I triage in seconds.
- **US-7** (MVP) As a Pilote, I want to retain, merge or reject an Idée, so that only what is worth it goes to Conception.

### Conception
A retained Idée goes through product design, mockups and technical design,
each one a conversation with an agent, each one approved by the Pilote.
- **US-8** (MVP) As a Pilote, I want to start the Conception of a retained Idée in one click, so that an agent runs the product design with me.
- **US-9** (MVP) As a Pilote, I want to drive an agent session from the product (read it, write to it, answer its questions and permission requests), so that I never need a terminal to talk to an agent.
- **US-10** (MVP) As a Pilote, I want to follow each Conception from the Idée to its Tickets (PRD, mockups, technical design), so that I know where each one stands.
- **US-11** (MVP) As a Pilote, I want to review a Conception document or a set of mockups and either approve it or ask for changes, so that nothing is built that I did not validate.

### Tickets and the Boucle
An approved Conception becomes Tickets; the Boucle implements them one by
one on the Runner, each through a reviewed PR that it merges itself once the
second agent and the checks pass; it stops for the Pilote only on a visual
review or a blocked Ticket.
- **US-12** (MVP) As a Pilote, I want an approved Conception split into Tickets that I validate in one pass, so that the agents know exactly what to build.
- **US-13** (MVP) As a Pilote, I want to start and stop the Boucle of a Projet, so that I decide when my machine and my subscription work.
- **US-14** (MVP) As a Pilote, I want to see which ticket each agent is on and at which step (coding, waiting for checks, in review), so that I know what my agents are doing right now.
- **US-15** (MVP) As a Pilote, I want each Ticket delivered as a PR that a second agent and the checks review, and that the Boucle merges itself once they pass, unless the Ticket needs a visual review or is blocked, so that I only look at what needs my eyes.
- **US-16** (MVP) As a Pilote, I want the planning of each Projet (what is next, what is blocked, by what), so that I see when a milestone will be done.
- **US-36** (MVP) As a Pilote, I want to review the captures of a Ticket with a visual review and either approve it, which merges its PR, or ask for changes with a comment that the Boucle takes up, while the Boucle goes on with the Tickets that do not depend on it, so that my review never stops the other work.

### « À toi »
Everything that waits for the Pilote is in one place, with a notification
when they are away.
- **US-17** (MVP) As a Pilote, I want every Décision that waits for me (a blocked Ticket, a Conception to review, a visual review, an interrupted Ticket) in « À toi », so that I never look for them.
- **US-18** (MVP) As a Pilote, I want a notification on my phone when a Décision waits and I am away, so that the agents do not stay stuck for hours.
- **US-19** (MVP) As a Pilote, I want to see « Runner hors ligne » in « À toi », with a notification, when work waits and my Runner is off, so that I do not believe agents are working when nothing runs.

### Real time
What the Pilote sees is the state of now.
- **US-20** (MVP) As a Pilote, I want a change on GitHub or from an agent on screen in under 2 s, without reloading, so that I can trust what I see.
- **US-21** (MVP) As a Pilote, I want to see « resynchronisation… » after a lost connection until the state is sure again, with the Actions sensibles unavailable until then, so that I never act on a stale state.

### Skins
The Pilote chooses how the product looks; a Moddeur writes their own Skin.
- **US-22** (MVP) As a Pilote, I want to choose a Thème (colours, type) for the default Skin, so that the product looks like I want without code.
- **US-23** (MVP) As a Moddeur, I want a documented SDK that gives the whole state and every action of the Process, so that I can write a Skin that does everything the default one does.
- **US-24** (MVP) As a Moddeur, I want to try my Skin on my account while I write it, so that I see it with my real Projets.
- **US-25** (MVP) As a Pilote, I want to choose the Skin used on the PC and the one used on the phone, a Skin saying whether it works on the PC, the phone or both, so that each screen gets a Skin made for it.
- **US-26** (MVP) As a Pilote, I want an Action sensible (merge, start the Boucle, approve a Conception) asked by any Skin to be confirmed in a dialog of the product itself, so that no Skin can act behind my back.
- **US-27** (MVP) As a Pilote, I want the product to fall back to the default Skin with a message when a Skin fails, and a fixed address that always opens the default Skin, so that I am never cut off from my Décisions.

### Language
- **US-28** (MVP) As a Pilote, I want the product in French or English, so that I use it in my language.

### Next
- **US-29** (next) As a Pilote, I want the official isometric open-space Skin, where agents are employees at their desks and Décisions are a HUD, so that following my agents is a pleasure.
- **US-30** (next) As a Pilote, I want the acceptance, release and operations stages (candidate, release button, prod watch), so that the Process goes to prod from the product.
- **US-31** (next) As a Pilote, I want to subscribe to a paid plan, so that I keep using the product after the beta.

### Later
- **US-32** (later) As a Pilote, I want agents to run in the product's cloud instead of my machine, so that they work when my PC is off.
- **US-33** (later) As a Pilote, I want to invite teammates with roles, so that a team drives its Projets together.
- **US-34** (later) As a Moddeur, I want to publish my Skin for others to install, so that the community shares its Skins.
- **US-35** (later) As a Pilote, I want to adapt the Process (stages, gates) to my Projets, so that it fits how I work.
- **US-37** (later) As a Pilote, I want to host the product on my own server, so that my Projets' state never leaves my infrastructure.

## Scope

| Version | Contains | Done when |
|---|---|---|
| MVP | US-1 to US-28 and US-36: one-person account, GitHub repositories, **Runner** on the **Pilote**'s machine; Idées, Conception, Tickets, Boucle, « À toi »; real-time state; **Thèmes** and full **Skins** through a documented SDK, the default sober **Skin**; French and English; free beta | the founder drives all their projects with it for 4 weeks, then 5 external beta testers are active every week |
| next | US-29 to US-31: the isometric open-space **Skin**, acceptance, release and operations, a paid plan | the isometric **Skin** is written with the public SDK only; a first paying **Pilote** |
| later | US-32 to US-35 and US-37: agents in our cloud, teams, shared **Skins**, an adaptable **Process**, self-hosting | — |

**Out**: GitLab and other code hosts (the **Process** is built on GitHub);
reselling AI usage (the **Pilote** brings their own subscriptions).

## Success criteria

- The founder drives all their projects with the product instead of the
  dotfiles console for 4 consecutive weeks, measured by the console no
  longer being used.
- Then 5 external beta testers are active every week (at least one ticket
  merged by the Boucle per week each), measured by the product's usage.
- A change on GitHub or from an agent is visible in under 2 s (p95),
  measured from the event to the screen.

## Constraints

- GitHub only (MVP); the **Pilote**'s own Claude or Codex subscription.
- UI in French and English from the MVP.
- Hosted by us (SaaS) in the MVP and next; self-hosting is `later` (US-37).

## Open questions

- The business model (subscription, free and paid tiers): the founder, after
  the beta testers.
- Demand validation: a sign-up page and 5 interviews, run alongside the
  technical design (ticket `externe`).
- Is the name « Crewdeck » free (trademark, domain)? The founder, before the
  sign-up page.
- Running agents in the product with the **Pilote**'s own Claude or Codex
  subscription: do the providers' terms allow it for a commercial product?
  The founder, before the beta.
