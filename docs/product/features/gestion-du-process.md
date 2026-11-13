# Gestion du process — Crewdeck

> Ideas: DCCM-IDEA#30. Approved: <PR link> (<date>). Product: [prd.md](../prd.md).

## Problem

- Crewdeck's **Process** was fixed (Idée → Conception → Tickets → Boucle) and
  every **Ticket** was a GitHub issue: a **Pilote** whose project lives in a
  folder of Markdown files, or whose team uses Jira, Confluence and
  Kubernetes, could not make the agents follow the process they run.
- A process is more than its stages: it is the tools each one uses (a design
  tool, a reviewer on another model, a command that deploys) and where each
  piece of work lives. Nowhere does a developer see it whole, nor know that
  it holds together before the agents start.
- When several tools carry the same thing (a ticket in Jira, a document in
  Confluence and in Obsidian), nothing says which one is right, and a sync
  both ways loses someone's edit.
- Workflow builders such as n8n let you draw anything, but they know nothing
  of a software project: no check that a step gets what it needs, no
  guarantee that a change is reviewed before it ships.

## Users

| Role | What they come for here |
|---|---|
| **Pilote** | Compose the **Process** of each **Projet** with the tools they use, see it whole, and know before the agents start that it holds together |

## Principles

- **Your Process, our guard-rails.** The **Pilote** draws; the core checks
  every arrow, keeps every **Contrat** and every gate, and refuses to
  activate a **Process** that has a **Manque**.
- **Before any merge, the checks and a Review.** They can run on any **Rôle**
  or any CI, never be removed nor bypassed.
- **One Source per Type d'artefact.** The **Source** wins; a **Copie** is
  written one way from it and never read back.
- **What runs keeps its version.** A change of the **Process** applies to the
  work that starts after it.
- **Local is a Source like the others.** A **Projet** with no **Connecteur**
  is complete: its folder on the **Pilote**'s machine holds everything.

## The two extreme cases

The design is held against two projects; every story below serves at least
one of them.

1. **All local.** Only Markdown files in a folder of the machine (the PRD,
   the mockups in code, the Tickets), the code in the same folder, the app
   launched on a local server of the machine (`docker compose up`, a script),
   no GitHub account linked. Every **Source** is **Local**; the checks and
   the launch are **Commandes**.
2. **Many tools.** GitHub for the code, Jira for the Tickets, Confluence for
   the documents with a **Copie** in an Obsidian vault, a dockerised app
   deployed to servers and to Kubernetes, mockups made with Stitch and Figma
   and reviewed by Gemini. GitHub, Jira and Confluence are **Sources**
   through their **Connecteurs**; Obsidian is a **Copie** to a folder; Stitch
   and Figma reach the agents of the mockups' **Étape** as **Serveurs MCP**;
   the review by Gemini is a **Review** on a **Rôle** whose **Moteur** is
   Gemini CLI; each deployment is a **Commande** of the « Livraison »
   **Phase**.

## Journeys

### Composing the Process

The **Pilote** opens « Gestion du process » for a **Projet**: an infinite
canvas where each **Phase** (« Idée », « Conception », « Développement »,
« Livraison ») is a large block holding its **Étapes**, linked by arrows,
each **Étape** showing the **Outils** attached to it. There are three levels
and no more: a **Phase** holds **Étapes**, an **Étape** uses **Outils**; a
**Phase** never holds another **Phase**. Each **Étape** declares its
**Entrées** and its **Sorties**, typed by a **Type d'artefact** from the
product's catalogue (at the MVP: Idée, PRD, Maquettes, Conception technique,
Inventaire, Ticket, Changement de code, Verdict, Livraison). An arrow goes
from a **Sortie** to an **Entrée** of the same type, and nowhere else. A
**Phase** can be **repeated for each** item of a list (the « Développement »
of the default **Modèle** runs for each ready **Ticket**: that repetition is
the **Boucle**). An **Étape** that judges (a **Review**, a **Revue croisée**,
a **Revue visuelle**, a gate of the **Pilote**) can have a **Retour** to an
earlier **Étape** of its **Phase**, taken while it asks for changes, up to a
maximum of iterations.

- **US-92** (MVP) As a Pilote, I want a « Gestion du process » page for each Projet, an infinite canvas where its Phases hold their Étapes linked by arrows, each Étape showing its Entrées, its Sorties and the Outils attached to it, so that I see my whole Process in one place.
- **US-93** (MVP) As a Pilote, I want to add Étapes from the catalogue (those of the default Modèle, the Revue croisée, the Revue visuelle, a Commande, another Review on the Rôle of my choice), remove them, move them between Phases, add and remove Phases, and attach Outils to an Étape (its Rôle, its Skill, Serveurs MCP, a Commande, the Connecteurs it reads), so that the Process does what my Projet needs.
- **US-94** (MVP) As a Pilote, I want an arrow accepted only from a Sortie to an Entrée of the same Type d'artefact, and the canvas listing every Manque (an Entrée nothing feeds, a Type d'artefact without a Source, a capability an Étape needs and no attached Outil gives, a merge with no checks or no Review before it), each one pointing at its block, a Process with a Manque not activable, so that a Process I compose always runs.
- **US-95** (MVP) As a Pilote, I want to make a Phase repeat for each item of a list (each ready Ticket, each retained Idée), and to draw a Retour from an Étape that judges to an earlier Étape of its Phase with a maximum of iterations (3 by default), reaching it stopping that item with a Décision, so that I set my loops without ever drawing an endless one.
- **US-96** (MVP) As a Pilote, I want to activate a changed Process as an Action sensible, after seeing what changed since the active version, the new version applying to the work that starts after it while what is in progress finishes on the version it started with, so that moving a block never breaks a Ticket under review.
- **US-97** (MVP) As a Pilote, I want each new Projet to start from a Modèle de process (« Process Crewdeck » by default: Idée, Conception, Tickets, Boucle, with their Étapes, Rôles and gates as today), and to save a Projet's Process as a Modèle of my own for my next Projets, so that I compose a Process once.
- **US-98** (MVP) As a Pilote, I want to read a Projet's Process on my phone as the list of its Phases and their Étapes, with its Manques, editing staying on the PC, so that I check it from anywhere.
- **US-107** (later) As a Pilote, I want to link an n8n workflow to my Process, an Étape starting it or the workflow starting a Phase, so that what I already automate in n8n joins my Projet's Process.
- **US-108** (later) As a Pilote, I want to create my own Types d'artefact (a name, where it lives, the rules its Contrat checks), so that my Process carries what the catalogue does not know.
- **US-109** (later) As a Pilote, I want the change of a Modèle de process of mine offered to the Projets that started from it, each one accepting it or not, so that improving a Modèle improves my Projets without redrawing them.

### Sources, Copies and Connecteurs

For each **Type d'artefact** of a **Projet**, the **Pilote** chooses its
**Source** on the canvas: **Local** (the **Projet**'s folder on the
**Runner**'s machine) or a **Connecteur** (GitHub at the MVP). The
**Miroir**, on the machine, holds every artefact of the **Projets**: what
is **Local** lives there and in the folder, the rest is a copy of its
**Source**; the agents read it, and every write goes to the **Source** first.
The **Source** always wins. The choice of the **Source** itself is US-88, in
[prd.md](../prd.md#next).

- **US-99** (MVP) As a Pilote, I want a Projet with no Connecteur at all, its documents and its Tickets being Markdown files of its folder on my machine that I can read and edit by hand, my edits on screen in under 2 s, the state of the work (who took a Ticket, its verdicts, its comments) kept on my machine, so that a Projet works without GitHub nor any other account.
- **US-102** (MVP) As a Pilote, I want to move a Type d'artefact to another Source as an Action sensible, the product moving what exists (the 30 local Tickets become 30 issues), the old place archived or kept as a Copie, the work in progress finishing on the old Source, so that a Type d'artefact never has two Sources.
- **US-103** (MVP) As a Pilote, I want the Source to win over the work in progress: a Ticket changed at its Source while an agent works on it keeps the version it was taken with, shows « modifié depuis sa prise » and can be restarted in one click; a Ticket closed at its Source stops, its branch kept and the stop noted in its history, starting again from that branch if it is reopened, so that what my team decides in its tools is never overridden by the agents.
- **US-100** (next) As a Pilote, I want to add Copies of a Type d'artefact (to another Connecteur, or to a folder of my machine such as an Obsidian vault), written one way from its Source after each change, so that my work is where I read it and backed up where I want.
- **US-101** (next) As a Pilote, I want a Décision « Copie modifiée hors de sa Source » when someone edits a Copie, offering to overwrite the Copie or to open the Source, the edit never being taken in silently, so that no edit made in the wrong place is lost without my knowing it.
- **US-110** (next) As a Pilote, I want Connecteurs for the ticket trackers and documentation tools of the moment (Jira, Linear, Confluence, Notion and the next ones), each able to be the Source or a Copie of a Type d'artefact, so that a Projet whose team already works in them keeps its tools.

### Outils on the machine

The agents reach any tool, even one with no **Connecteur** yet: a
**Serveur MCP** gives tools to the agents of an **Étape** (US-73), and a
**Commande** runs on the **Runner**'s machine, its secrets staying there.
A **Commande** judges by its exit code, and by a health address when the
**Pilote** gives one; the product never reads through a **Serveur MCP** nor a
**Commande**, so neither can be a **Source**. Declaring a **Serveur MCP** is US-73, in
[prd.md](../prd.md#tickets-and-the-boucle).

- **US-104** (MVP) As a Pilote, I want an Étape Commande that runs a command of my choice on my Runner's machine, in the Projet's folder or the Ticket's worktree (start a local server, run the tests, deploy with docker or kubectl), its verdict being its exit code and, if I give one, a health address that answers, its output readable like a Session's, so that my Process checks and launches things without a dedicated Connecteur.
- **US-105** (MVP) As a Pilote, I want to add a « Livraison » Phase after the merge, with a Commande « Lancer » (docker compose on my machine, a script), its failure raising a Décision, so that a local Projet goes from the Idée to a running app.
- **US-106** (MVP) As a Pilote, I want the checks of a change of code to be the CI of its GitHub repository, or Commandes on my Runner (its tests, its linters) for a Projet without CI, so that every change is checked before its Review lets it merge.

## Scope

| Version | Contains | Done when |
|---|---|---|
| MVP (`MVP`) | US-73, US-88, US-92 to US-99, US-102 to US-106: the canvas and the « Process Crewdeck » **Modèle**, the catalogue's **Étapes**, checked arrows and **Manques**, « pour chaque » and **Retours**, versioned activation, the **Pilote**'s **Modèles**; **Sources** Local and GitHub, their migration, the **Source** winning; **Commandes** (checks, launch) and **Serveurs MCP** | the first extreme case runs end to end (below) |
| Bêta (`next`) | US-100, US-101, with US-86 of [prd.md](../prd.md) (Gemini CLI first): **Copies**, the **Décision** on a **Copie** edited, more **Moteurs** | the second extreme case runs with its Tickets and documents on Local or GitHub |
| Lancement (`next`) | US-110, with US-35 and US-85 of [prd.md](../prd.md): **Connecteurs** for Jira, Confluence and the like, the **Pilote**'s own **Étapes**, design tools | the second extreme case runs whole |
| later | US-107 to US-109: n8n workflows, the **Pilote**'s own **Types d'artefact**, a **Modèle**'s changes offered to its **Projets** | — |

**Out**:
- A **Phase** inside a **Phase**: two levels of groups (a **Phase**, its
  **Étapes**) cover both extreme cases, and deeper nesting makes the
  **Manques** and the phone's list unreadable; reopened if a real process
  needs it.
- Cycles drawn freely: a **Retour** exists only where a verdict can say
  « start again », always with its maximum.
- Editing the canvas on the phone: dragging arrows on an infinite canvas
  with a finger is not done well by anyone; the phone reads it (US-98).
- A two-way sync between a **Source** and its **Copies** (see
  [prd.md](../prd.md#scope), « Out »).

## Success criteria

- MVP, first extreme case: a **Projet** with no **Connecteur** (Markdown
  files, a local server) goes from the Idée to a running app launched by a
  **Commande** on the machine, with no GitHub account linked to it,
  measured by that **Projet**'s history.
- MVP: the founder's GitHub **Projets** run on the « Process Crewdeck »
  **Modèle** unchanged, for the 4 weeks of the switchover (BIZ-4).
- MVP: a change on the canvas (an **Étape** removed, a **Source** moved)
  applies to the next work without restarting the server or the **Runner**,
  and a **Ticket** in progress finishes on its version, measured by a
  test **Projet**'s history.
- MVP: no **Process** with a **Manque** can be activated, and no merge
  happens without its checks and a **Review**, measured by the product's
  tests on every **Manque** of US-94.
- Bêta, second extreme case: Tickets and documents on Local or GitHub,
  mockups through the Stitch and Figma **Serveurs MCP**, their **Review** on
  Gemini, a **Copie** of the documents in an Obsidian folder, deployments
  to the servers and to Kubernetes by **Commandes**.
- Lancement, second extreme case whole: Tickets in Jira and documents in
  Confluence as **Sources**, through their **Connecteurs**.

## Constraints

- The server never reads the content of an artefact: a **Connecteur** other
  than GitHub, a **Serveur MCP** and a **Commande** run on the **Runner**,
  with their secrets ([prd.md](../prd.md#constraints), US-60).
- A tool that cannot notify its changes cannot keep the 2 s of US-20; its
  **Connecteur** says how late it may be. Local and GitHub both notify.
- The dotfiles console gets no configurable process: it stays the founder's
  tool, in maintenance only, until the switchover (BIZ-4); its Miroir keeps
  only what agent-loop reads (decided 2026-11-13, dotfiles side).

## Open questions

- A **Phase** inside a **Phase**: to reopen once a real process of a
  **Pilote** needs it. The founder, after the Bêta.
- More kinds of **Outils** than the five (**Connecteur**, **Serveur MCP**,
  **Rôle**, **Skill**, **Commande**): which ones, from the beta testers'
  processes. The founder, during the Bêta.
- The shape of the link with n8n (US-107): an **Outil**, a trigger of a
  **Phase**, or both. The founder, before the Lancement.
- How a **Connecteur** that is not GitHub follows its tool in real time from
  the **Runner** (webhooks need a public address): the technical design.
