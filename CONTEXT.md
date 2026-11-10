# Crewdeck

A web product where a solo developer drives their projects with AI agents,
from the idea to the merged ticket, in real time, through an interface they
can reshape entirely.

This document is a glossary, not a specification. The terms are in French,
the founder's language and the product's first UI language (the UI also
exists in English); each gives its code identifier, in English.

## Language

### People

**Pilote** (`Pilot`):
The person who has an account and drives their **Projets** and their agents
through the **Process**; one account is one **Pilote**.
_Avoid_: utilisateur, client, propriétaire, owner

**Visiteur** (`Visitor`):
Someone who discovers Crewdeck before signing up, on the demonstration
**Projet**; not yet a **Pilote**.
_Avoid_: prospect, invité, utilisateur anonyme

**Moddeur** (`Modder`):
A **Pilote** who writes their own **Skin** with the SDK, or their own
**Skill** for an **Étape**.
_Avoid_: développeur, créateur, thémeur

### Work

**Process** (`Process`):
The fixed sequence of stages every **Projet** follows, **Idée**,
**Conception**, **Tickets**, **Boucle**, with the gates where the **Pilote**
decides. « À toi » is not a stage: it gathers the **Décisions** of every
stage. The same for every **Pilote** (it is adaptable only `later`).
_Avoid_: workflow, pipeline, méthode

**Projet** (`Project`):
One repository (on GitHub at the MVP) followed by the product and prepared for the
**Process**; a **Pilote** has one or more **Projets**.
_Avoid_: repo, dépôt (in the UI, for a followed one), app

**Dépôt GitHub** (`Repository`):
A repository of the **Pilote**'s code host that the product does not follow
yet; once brought in, it is a **Projet**. Used only when picking what to
follow.
_Avoid_: repo, Projet (before it is followed)

**Étape** (`Step`):
One piece of work of the **Process** that an agent does in one **Rôle** with
one **Skill**: the analysis of an **Idée**, the PRD, the mockups, the
technical design, the split into **Tickets**, the Code, the Review. Each
**Étape** has one **Contrat**.
_Avoid_: tâche, job, phase (the **Process** has stages, an **Étape** is finer)

**Contrat** (`StepContract`):
What an **Étape** must produce for the product and the next **Étapes** to
use it (an analysed **Idée** has its summary, impact, effort; a PRD has its
stories), and its gates. Kept by the core; a **Skill** never changes it.
_Avoid_: schéma, spec, format

**Étape optionnelle** (`OptionalStep`):
A piece of the **Process** a **Pilote** may turn off for a **Projet**: the
mockups, the **Revue visuelle**, the visual audit, the user tests, the
preview, the **Revue croisée**. Most are **Étapes**; the **Revue visuelle**
is a gate of the **Pilote**'s. The analysis of an **Idée**, the **Tickets**,
the Code, the Review and the checks always run.
_Avoid_: option, module, plugin

**Revue croisée** (`CrossReview`):
The **Étape** where an agent in the « Review » **Rôle** reads the PRD, then
the technical design, of a **Conception**, just before the **Pilote**
approves each; every remark is fixed or answered « non retenue ».
_Avoid_: relecture, double review

**Revue visuelle** (`VisualReview`):
The gate where the **Pilote** looks at the captures of a **Ticket**'s screens
and approves it, which merges its PR, or asks for changes the **Boucle**
takes up.
_Avoid_: recette, QA, validation visuelle

**Inventaire** (`Inventory`):
What the product drafts when a **Dépôt GitHub** that already has code
becomes a **Projet**: its glossary, its « choix techniques » and the list of
what exists; the **Pilote** approves it, or sends it back, before the
**Process** starts.
_Avoid_: audit, état des lieux, decisions (a **Décision** waits for the
**Pilote**; a « choix technique » is a decision of the code)

**Skill** (`Skill`):
The instructions (and scripts) an agent follows to do an **Étape**, in the
`SKILL.md` format Claude Code and Codex read: the official one, or the
**Pilote**'s own (`next`).
_Avoid_: méthode, prompt, recette, plugin

**Idée** (`Idea`):
Something the **Pilote** wants, noted in a sentence, analysed, then retained,
merged into another **Idée** or rejected.
_Avoid_: demande, suggestion, feature request

**Conception** (`Design`):
The work that turns a retained **Idée** into **Tickets**: a PRD, mockups and
a technical design, each one approved by the **Pilote**.
_Avoid_: spec, cadrage

**Ticket** (`Ticket`):
One unit of work an agent implements in one reviewed PR; an issue of the
**Projet**'s code host (GitHub at the MVP).
_Avoid_: tâche, issue (in the UI), story

**Boucle** (`AgentLoop`):
The agents of a **Projet** taking its ready **Tickets** one by one, on the
**Runner**, until none is left or the **Pilote** stops it.
_Avoid_: agent-loop (in the UI), automate, job

**Session** (`AgentSession`):
One conversation of an agent in one **Rôle**, on the **Runner**, with one
**Moteur**: every **Étape** runs in a **Session**, the **Boucle**'s included,
and the **Pilote** can read and drive any of them. Its content stays between
the **Runner** and the **Appareils**; while the **Runner** is « hors ligne »
only its title and state are shown.
_Avoid_: conversation, run, exécution, job, chat

**Décision** (`Decision`):
Something that waits for the **Pilote** (a blocked **Ticket**, a document to
review, a visual review, an interrupted **Ticket**, « Runner hors ligne »);
every **Décision** is in « À toi ».
_Avoid_: tâche, alerte, notification

**Paramètres** (`Settings`):
Everything a **Pilote** sets: on their account, as the defaults, and on each
**Projet**, which inherits the account's **Paramètres** and changes only
what it needs.
_Avoid_: configuration, réglages, préférences

**Planification** (`Schedule`):
When a **Boucle** starts by itself: at a time, every night, or when a
**Compte IA**'s window resets.
_Avoid_: cron, tâche planifiée, programmation

**Plafond** (`SpendingCap`):
The most a **Projet** may spend on the **Pilote**'s API keys in a month;
reaching it stops the **Boucle** with a **Décision**.
_Avoid_: budget, limite (a **Compte IA** has limits, a **Projet** has a
**Plafond**)

**Journal des Décisions** (`DecisionLog`):
Every **Décision** the **Pilote** took (approval, refusal, answer), with its
reason and date, kept and searchable.
_Avoid_: historique, audit log

**Lien de suivi** (`ShareLink`):
A read-only, revocable address a **Pilote** gives a client to follow a
**Projet**: planning, progress, what is ready to try.
_Avoid_: portail client, lien public

### Machine

**Runner** (`Runner`):
The program installed on the **Pilote**'s machine, linked to their account,
that runs the agents on the **Pilote**'s **Comptes IA**. A **Pilote** has
one **Runner** (linking another replaces it); it is online or « hors
ligne ».
_Avoid_: agent (it runs agents), daemon, worker

**Appareil** (`Device`):
A browser the **Pilote** trusts to read what travels encrypted end to end
(**Sessions**, the text of the **Idées**); the first one is linked with the
**Runner**, each next one is approved from a trusted one.
_Avoid_: navigateur (when trust is meant), device, client

**Moteur** (`Engine`):
An agent program the **Runner** drives: Claude Code and Codex at the MVP,
the other agents of the moment, paid or open source, later (`next`). A
**Moteur** offers models, sometimes the **Pilote**'s own.
_Avoid_: provider, harness, IA, modèle (a **Moteur** offers several models)

**Compte IA** (`AiAccount`):
How the **Pilote** pays for a **Moteur**: their own sign-in to it, where the
provider allows it, or their own API key. It stays on the **Runner**; the
product never holds it.
_Avoid_: abonnement (one kind of **Compte IA** only), clé, credentials

**Rôle** (`AgentRole`):
What an agent is asked to do in the **Process**: « Idée », « Conception »,
« Code » or « Review »; each **Rôle** has one **Moteur** and one model.
_Avoid_: profil, mode, persona

### Interface

**Skin** (`Skin`):
A complete interface of the product: a set of **Composants**, starting from
a parent **Skin** whose **Composants** it does not replace. It says whether
it works on the PC, the phone or both. The default **Skin** is the sober
one.
_Avoid_: thème, template, UI, mod

**Composant** (`Component`):
One named, replaceable piece of the screen, from the **Cadre** to a status
badge, with its data and actions from the core and its versioned contract;
a **Composant** may hold others in its **Emplacements**.
_Avoid_: widget, bloc, élément, brique

**Emplacement** (`Slot`):
A named place inside a **Composant** that other **Composants** fill (a
page's list, a card's badges, the **Cadre**'s menu); a **Skin** may fill,
reorder or empty it.
_Avoid_: zone, slot (in the UI), conteneur

**Cadre** (`Shell`):
The **Composant** that lays out the whole page: where the menu, the page and
« À toi » go.
_Avoid_: layout, shell (in the UI), gabarit

**Connecteur** (`Connector`):
The link between a module of the **Process** and the outside tool that
serves it (GitHub, GitLab or Gitea as code host; Penpot, Pencil or Figma for
design; Slack; an issue tracker; a host for previews; or an MCP server of
the **Pilote**), chosen per **Projet**.
_Avoid_: intégration, plugin, extension

**Marketplace** (`Marketplace`):
Where a **Pilote** finds and installs **Skins** and **Skills**: the official
ones, and later those published by **Moddeurs** after review (a security
review for a **Skill**, which runs on the **Pilote**'s machine).
_Avoid_: store, boutique, galerie

**Thème** (`Theme`):
The colours and type of the default **Skin**, chosen without code.
_Avoid_: skin, style, palette

**Action sensible** (`SensitiveAction`):
An action a **Skin** may ask for but that the product always confirms in its
own dialog: merge, start the **Boucle**, approve a document of a
**Conception** (PRD, mockups, technical design, Tickets), approve the
inventory of an existing repository (and later release). Starting the
**Boucle**, or creating or resuming its **Planification**, also
confirms the merges it does itself, for the Tickets that pass their review,
until it is stopped or the **Planification** paused or deleted.
_Avoid_: action critique, action protégée

**Resynchronisation** (`Resync`):
The moment, after a lost connection, when the product rebuilds the state
and says so until it is sure again.
_Avoid_: rechargement, refresh

## Flagged ambiguities

- « revue visuelle » was listed among the **Étapes optionnelles** as if an
  agent did it: it is the **Pilote**'s gate; the **Revue croisée** is an
  agent's **Étape**. Both can be turned off.
- « decisions » of an existing repository clashed with **Décision**: they
  are « choix techniques », part of the **Inventaire**.
- « session », « run » and « exécution » were used for the work of an agent
  on an **Étape**: it is always a **Session**, driven by the **Pilote** or by
  the **Boucle**.

- "agent" meant both the AI that codes and the program on the machine:
  the AI is an agent, the program is the **Runner**.
- "skin" and "thème" were used for the same thing: a **Thème** only changes
  colours and type of the default **Skin**; a **Skin** is a whole interface.
- "skin" and "skill" sound alike: a **Skin** changes what the **Pilote**
  sees, a **Skill** changes how an agent works.
- "abonnement" was used for every way of paying the AI: the **Compte IA**
  is the general term; a subscription sign-in is only one kind of it, and
  only where the provider allows it.

## Example dialogue

> **Dev**: If a Skin shows a « Merger » button, does the click merge?
> **Fondateur**: No. Merging is an **Action sensible**: the Skin asks, the
> product opens its own confirmation, and only then the PR is merged.
> **Dev**: And if the **Runner** is off when a **Ticket** is ready?
> **Fondateur**: The **Boucle** waits and « À toi » shows the **Décision**
> « Runner hors ligne », with a notification.
