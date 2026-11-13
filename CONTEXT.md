# Crewdeck

A web product where a solo developer drives their projects with AI agents,
through a process they compose with the tools they choose, from the idea to
the merged ticket and its launch, in real time, through an interface they
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
How a **Projet**'s work goes, from the **Idée** to the merge and its launch:
its **Phases**, their **Étapes** linked by arrows, the **Outils** each
**Étape** uses and the **Source** of each **Type d'artefact**, composed by
the **Pilote** in « Gestion du process » from a **Modèle de process**. Each
**Projet** has its own, versioned: work in progress finishes on the version
it started with. « À toi » is not a stage: it gathers the **Décisions** of
every **Phase**.
_Avoid_: workflow, pipeline, méthode

**Modèle de process** (`ProcessTemplate`):
A **Process** a new **Projet** starts from, copied into it: « Process
Crewdeck » (Idée → Conception → Tickets → Boucle, with their **Étapes** and
gates), the default, or one the **Pilote** saved from a **Projet**.
_Avoid_: template (in the UI), gabarit, preset

**Gestion du process** (`ProcessEditor`):
The page of a **Projet** where the **Pilote** composes its **Process** on an
infinite canvas (edited on the PC, read as a list on the phone).
_Avoid_: éditeur, workflow builder, canevas (in the UI, as the page's name)

**Phase** (`Phase`):
A large block of a **Process** that holds **Étapes** and sets their bounds
(« Idée », « Conception », « Développement », « Livraison »). A **Phase**
never holds another **Phase**. It may be repeated for each item of a list
(each ready **Ticket**: the **Boucle**).
_Avoid_: étape (for the large block), stage, groupe, section

**Projet** (`Project`):
A body of work the product follows with its own **Process**: its code in a
folder of the **Runner**'s machine or in a repository of a code host (GitHub
at the MVP), its other artefacts at the **Sources** its **Process** names; a
**Pilote** has one or more **Projets**.
_Avoid_: repo, dépôt (in the UI, for a followed one), app

**Dépôt GitHub** (`Repository`):
A repository of the **Pilote**'s code host that the product does not follow
yet; once brought in, it is a **Projet**. Used only when picking what to
follow.
_Avoid_: repo, Projet (before it is followed)

**Étape** (`Step`):
One piece of work inside a **Phase**: an agent's, in one **Rôle** with one
**Skill** (the analysis of an **Idée**, the PRD, the mockups, the technical
design, the split into **Tickets**, the Code, the **Review**), a gate of the
**Pilote**'s (the **Revue visuelle**, an approval), or a **Commande**. It
declares its **Entrées** and **Sorties**, uses its **Outils**, and has one
**Contrat**.
_Avoid_: tâche, job, phase (a **Phase** holds **Étapes**), bloc

**Entrée** / **Sortie** (`StepInput` / `StepOutput`):
What an **Étape** consumes and what it produces, each typed by a **Type
d'artefact**. An arrow of the canvas goes from a **Sortie** to an **Entrée**
of the same type, and nowhere else.
_Avoid_: input, output, port, dépendance

**Type d'artefact** (`ArtifactType`):
A kind of thing the **Étapes** pass along, from the product's catalogue:
Idée, PRD, Maquettes, Conception technique, Inventaire, Ticket, Changement
de code, Verdict, Livraison. Each has one **Source** per **Projet**. The
**Pilote**'s own types come `later`.
_Avoid_: format, document (one type among others), objet

**Artefact** (`Artifact`):
One thing of a **Type d'artefact** in a **Projet** (this PRD, Ticket #12, the
merged change of Ticket #12), kept at its **Source**.
_Avoid_: livrable, fichier (it may not be one), ressource

**Retour** (`LoopBack`):
The arrow from an **Étape** that judges (a **Review**, a **Revue croisée**,
a **Revue visuelle**, a gate) back to an earlier **Étape** of its **Phase**,
taken while it asks for changes, up to a maximum of iterations (3 by
default); reaching it stops that item with a **Décision**.
_Avoid_: boucle (that is the **Boucle**), cycle, retry

**Manque** (`ProcessGap`):
What keeps a **Process** from being activated, shown on its block: an
**Entrée** nothing feeds, a **Type d'artefact** without a **Source**, a
capability no attached **Outil** gives, a change of code that merges
without its checks or a **Review** before it.
_Avoid_: erreur, warning, avertissement

**Outil** (`Tool`):
What an **Étape** uses, attached to it on the canvas: a **Connecteur**, a
**Serveur MCP**, a **Rôle**, a **Skill** or a **Commande**.
_Avoid_: harness (it is a **Rôle**'s **Moteur**), plugin, intégration

**Serveur MCP** (`McpServer`):
An **Outil** that gives tools to the agents of the **Étapes** it is attached
to (Stitch, Figma, a database), declared on the **Runner** with its secrets.
The product never reads through it: it cannot be a **Source**.
_Avoid_: MCP (alone), connecteur, plugin

**Commande** (`Command`):
An **Outil**, or an **Étape** of its own, that runs a command of the
**Pilote**'s on the **Runner**'s machine (the tests, `docker compose up`, a
deployment), judged by its exit code and, when given, a health address;
its secrets stay on the **Runner**.
_Avoid_: script, job, hook, tâche

**Contrat** (`StepContract`):
What an **Étape** needs (its **Entrées**), what it must produce (its
**Sorties**, and the rules they meet: an analysed **Idée** has its summary,
impact, effort; a PRD has its stories), and its gates, checked wherever the
**Source** keeps the **Artefact**. Kept by the core; a **Skill** never
changes it.
_Avoid_: schéma, spec, format

**Review** (`Review`):
The **Étape** where an agent judges an **Artefact** (a **Ticket**'s change of
code, mockups, a document) and gives its **Verdict**, on the **Rôle** of the
**Pilote**'s choice (for a change of code, another **Moteur** than the
Code's by default). A **Process** always has one, with the checks, before a
change of code merges: it can be replaced by another **Rôle**'s, never
removed. A document of a **Conception** merges on the **Pilote**'s approval.
_Avoid_: revue de code (in the UI), relecture, code review

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
What the product drafts when a folder or a **Dépôt GitHub** that already has
code becomes a **Projet**: its glossary, its « choix techniques » and the list of
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
One unit of work an agent implements in one reviewed change of code (a PR
on GitHub, a branch on a local **Projet**), kept at the **Source** of the
**Projet**'s Tickets: a Markdown file of its folder, a GitHub issue, later a
Jira issue.
_Avoid_: tâche, issue (in the UI), story

**Boucle** (`AgentLoop`):
The agents of a **Projet** taking its ready **Tickets** one by one, on the
**Runner**, until none is left or the **Pilote** stops it: the **Phase**
repeated for each ready **Ticket** (« Développement » in the default
**Modèle de process**).
_Avoid_: agent-loop (in the UI), automate, job, boucle (for a **Retour**)

**Session** (`AgentSession`):
One conversation of an agent in one **Rôle**, on the **Runner**, with one
**Moteur**: every agent **Étape** runs in a **Session** (a **Commande** or a
gate of the **Pilote**'s does not), the **Boucle**'s included,
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
A named pair of a **Moteur** and a model that an agent **Étape** names:
« Idée », « Conception », « Code » and « Review » by default, and those the
**Pilote** adds (« Revue Gemini »). Changing a **Rôle** changes every
**Étape** that names it.
_Avoid_: profil, mode, persona, harness

**Miroir** (`Mirror`):
The store, on the **Runner**'s machine, of every **Artefact** of the
**Pilote**'s **Projets** and of what their work writes (comments, review
remarks): what is **Local** lives there (with the **Projet**'s folder), the rest is a copy of its
**Source**, written only from what the **Source** answers. The agents' one
channel: they read it, and every write goes to the **Source** first. Live,
or « en retard » since its last change applied.
_Avoid_: cache, base locale, réplique, copie locale, Copie (a **Copie** is
another tool's)

**Source** (`Source`):
The one place that holds a **Type d'artefact** of a **Projet**: **Local** or
a **Connecteur** (GitHub at the MVP). It always wins: an edit there applies,
a **Ticket** closed there stops. Moving a type to another **Source** is a
migration, an **Action sensible**.
_Avoid_: vérité, origine, master, référentiel

**Local** (`LocalSource`):
The **Source** that is the **Projet**'s own folder on the **Runner**'s
machine (Markdown files the **Pilote** reads and edits by hand) and the
**Miroir**, for what the work writes; the product keeps the state of the
work (what is taken, what passed) as for any **Projet**. A **Projet** with no **Connecteur** is
all **Local**.
_Avoid_: hors ligne, déconnecté, fichiers locaux

**Copie** (`Replica`):
Another tool that carries a **Type d'artefact** besides its **Source**
(Confluence's pages backed up in an Obsidian folder), written one way from
the **Source**, never read back; an edit made there raises a **Décision**
(`next`).
_Avoid_: sauvegarde, miroir (the **Miroir** is the machine's store), synchro

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
An **Outil** through which the product knows an outside tool: it can be the
**Source** or a **Copie** of a **Type d'artefact**, bring its changes in real
time and be read by the **Contrats** (GitHub at the MVP; GitLab, Gitea,
Jira, Confluence, Figma later). Written by the product, by **Moddeurs**
`later`. A tool without one reaches the agents through a **Serveur MCP** or
a **Commande**.
_Avoid_: intégration, plugin, extension, MCP (a **Serveur MCP** cannot be a
**Source**)

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
inventory of an existing repository, activate a changed **Process**, move a
**Type d'artefact** to another **Source** (and later release). Starting the
**Boucle**, or creating or resuming its **Planification**, also
confirms the merges it does itself, for the Tickets that pass their review,
until it is stopped or the **Planification** paused or deleted.
_Avoid_: action critique, action protégée

**Resynchronisation** (`Resync`):
The moment, after a lost connection, when the product rebuilds the state
and says so until it is sure again.
_Avoid_: rechargement, refresh

## Flagged ambiguities

- « grandes étapes » (Conception, Développement) clashed with **Étape**: the
  large blocks are **Phases**; an **Étape** stays the finer piece of work.
- « harness » was used for what runs an agent: it is a **Rôle**'s
  **Moteur**; an **Outil** is anything attached to an **Étape**.
- « vérité » of an artefact: its **Source**; « sauvegarde » (Obsidian): a
  **Copie**; the **Miroir** is neither, it is the machine's store.
- « boucle » with a maximum of iterations is a **Retour**; the **Boucle** is
  the **Phase** repeated for each ready **Ticket**.
- « Étape optionnelle » is gone: an **Étape** is added or removed on the
  canvas; only the checks and the **Review** before a change of code merges
  cannot go.

- « revue visuelle » was listed among the optional steps as if an agent did
  it: it is the **Pilote**'s gate; the **Revue croisée** is an agent's
  **Étape**. Both can be removed from a **Process**.
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
