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

**Moddeur** (`Modder`):
A **Pilote** who writes their own **Skin** with the SDK.
_Avoid_: développeur, créateur, thémeur

### Work

**Process** (`Process`):
The fixed sequence of stages every **Projet** follows, **Idée**,
**Conception**, **Tickets**, **Boucle**, with the gates where the **Pilote**
decides. « À toi » is not a stage: it gathers the **Décisions** of every
stage. The same for every **Pilote** (it is adaptable only `later`).
_Avoid_: workflow, pipeline, méthode

**Projet** (`Project`):
One GitHub repository followed by the product and prepared for the
**Process**; a **Pilote** has one or more **Projets**.
_Avoid_: repo, dépôt (in the UI), app

**Idée** (`Idea`):
Something the **Pilote** wants, noted in a sentence, analysed, then retained,
merged into another **Idée** or rejected.
_Avoid_: demande, suggestion, feature request

**Conception** (`Design`):
The work that turns a retained **Idée** into **Tickets**: a PRD, mockups and
a technical design, each one approved by the **Pilote**.
_Avoid_: spec, cadrage

**Ticket** (`Ticket`):
One unit of work an agent implements in one reviewed PR; a GitHub issue.
_Avoid_: tâche, issue (in the UI), story

**Boucle** (`AgentLoop`):
The agents of a **Projet** taking its ready **Tickets** one by one, on the
**Runner**, until none is left or the **Pilote** stops it.
_Avoid_: agent-loop (in the UI), automate, job

**Décision** (`Decision`):
Something that waits for the **Pilote** (a blocked **Ticket**, a document to
review, a visual review, an interrupted **Ticket**, « Runner hors ligne »);
every **Décision** is in « À toi ».
_Avoid_: tâche, alerte, notification

### Machine

**Runner** (`Runner`):
The program installed on the **Pilote**'s machine, linked to their account,
that runs the agents on the **Pilote**'s **Comptes IA**. A **Pilote** has
one **Runner**; it is online or « hors ligne ».
_Avoid_: agent (it runs agents), daemon, worker

**Moteur** (`Engine`):
An official agent program the **Runner** drives: Claude Code or Codex.
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

**Marketplace** (`Marketplace`):
Where a **Pilote** finds and installs **Skins**: the official ones, and
later those published by **Moddeurs** after review.
_Avoid_: store, boutique, galerie

**Thème** (`Theme`):
The colours and type of the default **Skin**, chosen without code.
_Avoid_: skin, style, palette

**Action sensible** (`SensitiveAction`):
An action a **Skin** may ask for but that the product always confirms in its
own dialog: merge, start the **Boucle**, approve a **Conception** (and later
release). Starting the **Boucle** also confirms the merges it does itself,
for the Tickets that pass their review, until it is stopped.
_Avoid_: action critique, action protégée

**Resynchronisation** (`Resync`):
The moment, after a lost connection, when the product rebuilds the state
and says so until it is sure again.
_Avoid_: rechargement, refresh

## Flagged ambiguities

- "agent" meant both the AI that codes and the program on the machine:
  the AI is an agent, the program is the **Runner**.
- "skin" and "thème" were used for the same thing: a **Thème** only changes
  colours and type of the default **Skin**; a **Skin** is a whole interface.
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
