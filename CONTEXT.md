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
The fixed sequence of stages and gates every **Projet** follows: **Idée**,
**Conception**, **Tickets**, **Boucle**, « À toi ». The same for every
**Pilote** (it is adaptable only `later`).
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
that runs the agents with the **Pilote**'s own AI subscriptions. A
**Pilote** has one **Runner**; it is online or « hors ligne ».
_Avoid_: agent (it runs agents), daemon, worker

### Interface

**Skin** (`Skin`):
A complete interface of the product, drawn on the state and the actions the
SDK gives; it says whether it works on the PC, the phone or both. The
default **Skin** is the sober one.
_Avoid_: thème, template, UI, mod

**Thème** (`Theme`):
The colours and type of the default **Skin**, chosen without code.
_Avoid_: skin, style, palette

**Action sensible** (`SensitiveAction`):
An action a **Skin** may ask for but that the product always confirms in its
own dialog: merge, start the **Boucle**, approve a **Conception** (and later
release).
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

## Example dialogue

> **Dev**: If a Skin shows a « Merger » button, does the click merge?
> **Fondateur**: No. Merging is an **Action sensible**: the Skin asks, the
> product opens its own confirmation, and only then the PR is merged.
> **Dev**: And if the **Runner** is off when a **Ticket** is ready?
> **Fondateur**: The **Boucle** waits and « À toi » shows the **Décision**
> « Runner hors ligne », with a notification.
