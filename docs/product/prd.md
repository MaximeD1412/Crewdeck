# Crewdeck — PRD

> Ideas: DCCM-IDEA#29. Approved: <PR link> (<date>).

## Problem

- A solo developer who drives several projects with AI agents (Claude Code,
  Codex) juggles GitHub, terminals and chat apps to know what each agent is
  doing and what waits for them.
- The state they see lags behind: a merged PR, a failed check or an agent
  waiting for a decision shows up minutes later, or not at all.
- The tools that exist impose one interface; a developer cannot shape the
  view of their own work (from a sober dashboard to a game-like office).

## Users

| Role | Who | What they come for |
|---|---|---|
| **Pilote** | A solo developer with a GitHub account and their own Claude or Codex subscription, driving several projects with agents; the first one is the founder | Follow ideas, designs, tickets and agents in real time, and decide at the process's gates, from the PC or the phone |
| **Moddeur** | A **Pilote** who writes their own **Skin** with the SDK | Change the whole look of the product while keeping its logic |

## Principles

- **The process is the product.** Ideas → design → tickets → agent loop →
  review: the stages and gates are ours, the same for every **Pilote**.
- **Real time.** A change on GitHub or from an agent is on screen in under
  2 s.
- **The core keeps the logic, the Skin only draws.** A **Skin** reads the
  state and asks for actions; it never decides alone.
- **A sensitive action is always confirmed by the core** (merge, launch, and
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
- **US-4** (MVP) As a Pilote, I want to see for each project what is still missing to run the Process, so that I know what to fix before the agents start.

### Ideas
The Pilote notes an idea from anywhere; an analysis qualifies it and they
triage it.
- **US-5** (MVP) As a Pilote, I want to note an idea in one sentence from the PC or the phone, so that nothing is lost.
- **US-6** (MVP) As a Pilote, I want each idea analysed (summary, target project, impact, effort, possible duplicates), so that I triage in seconds.
- **US-7** (MVP) As a Pilote, I want to retain, merge or reject an idea, so that only what is worth it goes to design.

### Design
A retained idea goes through product design, mockups and technical design,
each one a conversation with an agent, each one approved by the Pilote.
- **US-8** (MVP) As a Pilote, I want to start the design of a retained idea in one click, so that an agent runs the product design with me.
- **US-9** (MVP) As a Pilote, I want to drive an agent session from the product (read it, write to it, answer its questions and permission requests), so that I never need a terminal to talk to an agent.
- **US-10** (MVP) As a Pilote, I want to follow each design from the idea to its tickets (PRD, mockups, technical design), so that I know where each one stands.
- **US-11** (MVP) As a Pilote, I want to review a design document or a set of mockups and either approve it or ask for changes, so that nothing is built that I did not validate.

### Tickets and the agent loop
An approved design becomes tickets; the agents implement them one by one on
the Runner, each through a reviewed PR.
- **US-12** (MVP) As a Pilote, I want an approved design split into tickets that I validate in one pass, so that the agents know exactly what to build.
- **US-13** (MVP) As a Pilote, I want to start and stop the agent loop of a project, so that I decide when my machine and my subscription work.
- **US-14** (MVP) As a Pilote, I want to see which ticket each agent is on and at which step (coding, waiting for checks, in review), so that I know what my agents are doing right now.
- **US-15** (MVP) As a Pilote, I want each ticket delivered as a PR reviewed by a second agent and by the checks, so that I only look at work that already passed them.
- **US-16** (MVP) As a Pilote, I want the planning of each project (what is next, what is blocked, by what), so that I see when a milestone will be done.

### « À toi »
Everything that waits for the Pilote is in one place, with a notification
when they are away.
- **US-17** (MVP) As a Pilote, I want every decision that waits for me (a blocked ticket, a design to review, a visual review, an interrupted ticket) in « À toi », so that I never look for them.
- **US-18** (MVP) As a Pilote, I want a notification on my phone when a decision waits and I am away, so that the agents do not stay stuck for hours.
- **US-19** (MVP) As a Pilote, I want to see « Runner hors ligne » in « À toi », with a notification, when work waits and my Runner is off, so that I do not believe agents are working when nothing runs.

### Real time
What the Pilote sees is the state of now.
- **US-20** (MVP) As a Pilote, I want a change on GitHub or from an agent on screen in under 2 s, without reloading, so that I can trust what I see.
- **US-21** (MVP) As a Pilote, I want to see « resynchronisation… » after a lost connection until the state is sure again, so that I never act on a stale state.

### Skins
The Pilote chooses how the product looks; a Moddeur writes their own Skin.
- **US-22** (MVP) As a Pilote, I want to choose a Theme (colours, type) for the default Skin, so that the product looks like I want without code.
- **US-23** (MVP) As a Moddeur, I want a documented SDK that gives the whole state and every action of the Process, so that I can write a Skin that does everything the default one does.
- **US-24** (MVP) As a Moddeur, I want to try my Skin on my account while I write it, so that I see it with my real projects.
- **US-25** (MVP) As a Pilote, I want to choose the Skin used on the PC and the one used on the phone, a Skin saying whether it works on the PC, the phone or both, so that each screen gets a Skin made for it.
- **US-26** (MVP) As a Pilote, I want a sensitive action (merge, start the loop, approve a design) asked by any Skin to be confirmed in a dialog of the product itself, so that no Skin can act behind my back.
- **US-27** (MVP) As a Pilote, I want the product to fall back to the default Skin with a message when a Skin fails, and a fixed address that always opens the default Skin, so that I am never cut off from my decisions.

### Language
- **US-28** (MVP) As a Pilote, I want the product in French or English, so that I use it in my language.

### Next
- **US-29** (next) As a Pilote, I want the official isometric open-space Skin, where agents are employees at their desks and decisions are a HUD, so that following my agents is a pleasure.
- **US-30** (next) As a Pilote, I want the acceptance, release and operations stages (candidate, release button, prod watch), so that the Process goes to prod from the product.
- **US-31** (next) As a Pilote, I want to subscribe to a paid plan, so that I keep using the product after the beta.

### Later
- **US-32** (later) As a Pilote, I want agents to run in the product's cloud instead of my machine, so that they work when my PC is off.
- **US-33** (later) As a Pilote, I want to invite teammates with roles, so that a team drives its projects together.
- **US-34** (later) As a Moddeur, I want to publish my Skin for others to install, so that the community shares its Skins.
- **US-35** (later) As a Pilote, I want to adapt the Process (stages, gates) to my projects, so that it fits how I work.

## Scope

| Version | Contains | Done when |
|---|---|---|
| MVP | US-1 to US-28: one-person account, GitHub repositories, **Runner** on the **Pilote**'s machine; ideas, design, tickets, agent loop, « À toi »; real-time state; **Themes** and full **Skins** through a documented SDK, the default sober **Skin**; French and English; free beta | the founder drives all their projects with it for 4 weeks, then 5 external beta testers are active every week |
| next | US-29 to US-31: the isometric open-space **Skin**, acceptance, release and operations, a paid plan | the isometric **Skin** is written with the public SDK only; a first paying **Pilote** |
| later | US-32 to US-35: agents in our cloud, teams, shared **Skins**, an adaptable **Process**, self-hosting | — |

**Out**: GitLab and other code hosts (the **Process** is built on GitHub);
reselling AI usage (the **Pilote** brings their own subscriptions).

## Success criteria

- The founder drives all their projects with the product instead of the
  dotfiles console for 4 consecutive weeks, measured by the console no
  longer being used.
- Then 5 external beta testers are active every week (at least one ticket
  merged by the agent loop per week each), measured by the product's usage.
- A change on GitHub or from an agent is visible in under 2 s (p95),
  measured from the event to the screen.

## Constraints

- GitHub only (MVP); the **Pilote**'s own Claude or Codex subscription.
- UI in French and English from the MVP.
- Hosted by us (SaaS).

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
