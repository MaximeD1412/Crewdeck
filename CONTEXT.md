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
The person who owns a **Projet**, its **Runner** and its **Comptes IA**, and
drives it and its agents through the **Process**. One account is one
person: the **Pilote** of their own **Projets**, and possibly a **Membre**
of someone else's.
_Avoid_: utilisateur, client, propriétaire, owner

**Identité** (`PilotIdentity`):
A way a person (a **Pilote**, a **Membre**) signs in: an email address, a
Google account or a GitHub account; an account has one or more.
_Avoid_: compte (the account is the person), login, provider

**Membre** (`Member`):
A person a **Pilote** invites onto one of their **Projets**, by email, with
an **Accès**; needs no **Runner** nor **Compte IA**. A **Pilote** is not a
**Membre** of their own **Projets**.
_Avoid_: invité, collaborateur, utilisateur, client (a client is a
**Membre** with the **Accès** « Relecteur »)

**Accès** (`AccessProfile`):
A named set of **Droits** given to a **Membre** on a **Projet**. Four by
default, which never change: « Relecteur » (reads what is submitted to
them, comments, gives an **Avis**), « Contributeur » (notes and triages
**Idées**, comments, reads the **Sessions**), « Co-pilote » (also drives
**Sessions** and the **Boucle**, approves, settles **Décisions**),
« Administrateur » (also manages the **Membres** and changes the
**Process**). A **Pilote** creates their own by duplicating one, in their
account, offered on all their **Projets**; only they create or change one.
A **Membre** who manages the **Membres** gives an existing **Accès**, never
changes one.
_Avoid_: rôle (a **Rôle** is an agent's), permission, profil

**Droit** (`Permission`):
One thing an **Accès** allows on a **Projet** (read the **Sessions**, give
an **Avis**, approve, manage the **Membres**…). Deleting or transferring the
**Projet**, and the **Pilote**'s own **Runner** and **Comptes IA**, are
never a **Droit**: they stay the **Pilote**'s. No one grants a **Droit** they
do not hold.
_Avoid_: permission, autorisation

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

**Version** / **Brouillon** (`ProcessVersion` / `ProcessDraft`):
A **Version** is a numbered, frozen state of a **Projet**'s **Process**
(« v3 »), the active one being the last activated; the **Brouillon** is the
one change in progress on it, activated as the next **Version** once it has
no **Manque**. Work pins the **Version** active when it starts.
_Avoid_: révision, copie de travail, historique

**Modèle de process** (`ProcessTemplate`):
A **Process** a new **Projet** starts from, copied into it: « Process
Crewdeck » (Idée → Conception → Tickets → Boucle, with their **Étapes** and
gates), the default, or one the **Pilote** saved from a **Projet**'s active
version (never its **Sources**), listed in the account's **Paramètres**.
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

**Projet d'équipe** (`TeamProject`):
A **Projet** where someone other than its **Pilote** may drive the agents (a
**Membre** with that **Droit**); its agents run on API keys only, a
subscription being personal.
_Avoid_: espace, workspace, organisation

**Dépôt GitHub** (`Repository`):
A repository of the **Pilote**'s code host that the product does not follow
yet; once brought in, it is a **Projet**. Used only when picking what to
follow.
_Avoid_: repo, Projet (before it is followed)

**Étape** (`Step`):
One piece of work inside a **Phase**: an agent's, in one **Rôle** with one
**Skill** (the analysis of an **Idée**, the PRD, the mockups, the technical
design, the split into **Tickets**, the Code, the **Review**), a gate of the
**Pilote**'s (the **Revue visuelle**, an approval), a **Commande**, or an
**Étape du produit**. It declares its **Entrées** and **Sorties**, uses its **Outils**, and has one
**Contrat**.
_Avoid_: tâche, job, phase (a **Phase** holds **Étapes**), bloc

**Étape du produit** (`CoreStep`):
An **Étape** the product runs itself and keeps in every **Process** that
merges code: « Checks » (the CI of the repository, or **Commandes**, as its
**Outils**) and « Merge ». Moved like any **Étape**, never removed nor
added; not in the catalogue. Shown « Crewdeck » on the canvas.
_Avoid_: étape système, étape obligatoire, Fusion (for the « Merge »)

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
default); reaching it stops that item with a **Décision** that offers one
more pass or to stop it.
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

**Amendement** (`Amendment`):
A change to a text document of a **Projet** (the PRD, the glossary, an ADR,
the technical design) that an agent proposes when a **Ticket** contradicts
it, joined to its « Ticket bloqué »; approving it is an **Action sensible**,
and the **Ticket** starts again on the new version.
_Avoid_: correctif, patch de spec, révision

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
the **Runner** and the **Appareils**: at the MVP, while the **Runner** is
« hors ligne » only its title and state are shown; from the Lancement it is
also stored encrypted, readable with the **Runner** off as long as its
**Ticket** or **Étape** is open and 30 days after. A **Session** with no progress is
interrupted (« Session sans progrès »); one the **Pilote** continues in their
terminal is « repris hors Crewdeck », its work left alone by the **Boucle**
until they give it back.
_Avoid_: conversation, run, exécution, job, chat

**Décision** (`Decision`):
Something that waits for the **Pilote** (a blocked **Ticket**, a document to
review, a visual review, an interrupted **Ticket**, a « Session sans
progrès », « Runner hors ligne »);
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
Every **Décision** taken (approval, refusal, answer), with its reason, its
date and who took it, kept and searchable; kept by Crewdeck, and written as a
**Copie** in the folder of a **Local** **Projet**.
_Avoid_: historique, audit log

**Version soumise** (`Submission`):
A fixed copy of a document of a **Conception**, of mockups or of the
captures of a visual review that a **Pilote** submits to Relecteurs; stored
encrypted, readable with every machine off and without access to its
**Source**. A new version is submitted again; each **Avis** stays with its
version.
_Avoid_: partage, snapshot, envoi

**Avis** (`ReviewOpinion`):
What a **Membre** answers on a **Version soumise**: « approuvé » or
« changements demandés », with their comments. It informs the **Décision**
of the review, never settles it.
_Avoid_: approbation (that is the **Pilote**'s gate), vote, verdict (a
**Contrat**'s or a **Review**'s)

**Commentaire** (`Comment`):
A remark of a person on a passage of a document or a zone of a mockup or a
capture. It reaches an agent only as part of a **Retour**, when the person
who asks for changes keeps it.
_Avoid_: note, annotation

**Historique** (`ActivityLog`):
Every action of a person on a **Projet** (an invitation, an **Avis**, an
approval, a merge, a change of the **Process**…), and every action of an
agent credited to whoever started it, with who, what and when; kept as long
as the **Projet**. The reasons are the **Journal des Décisions**'s.
_Avoid_: journal (that is the **Journal des Décisions**), audit, logs

**Lien de suivi** (`ShareLink`):
A read-only, revocable address a **Pilote** gives a client to follow a
**Projet**: planning, progress, what is ready to try.
_Avoid_: portail client, lien public

### Machine

**Runner** (`Runner`):
The program installed on the **Pilote**'s machine, linked to their account,
that runs the agents on the **Pilote**'s **Comptes IA**. A person has one
**Runner** of their own (linking another replaces it); a **Projet** may
also have a **Runner partagé**. A **Runner** is online or « hors ligne ».
_Avoid_: agent (it runs agents), daemon, worker

**Runner partagé** (`SharedRunner`):
A **Runner** on a server, linked to one **Projet** rather than to a person,
carrying API keys only, each put there for that **Projet** by its
**Pilote** or a **Membre** allowed to and paid by whoever put it, where the **Membres** allowed to drive the agents
run their **Sessions** and the **Boucle**; it may hold the folder of a
**Local** **Projet**. A **Projet** has at most one.
_Avoid_: serveur d'équipe, runner cloud (the hosted **Runner** is `later`)

**Appareil** (`Device`):
A browser a person trusts to read what travels encrypted end to end
(**Sessions**, the text of the **Idées**); a **Pilote**'s first one is linked
with the **Runner**, a **Membre**'s first one by their invitation, each next
one is approved from a trusted one.
_Avoid_: navigateur (when trust is meant), device, client

**Moteur** (`Engine`):
An agent program the **Runner** drives: Claude Code and Codex at the MVP,
the other agents of the moment, paid or open source, later (`next`). A
**Moteur** offers models, sometimes the **Pilote**'s own.
_Avoid_: provider, harness, IA, modèle (a **Moteur** offers several models)

**Compte IA** (`AiAccount`):
How the **Pilote** (or, on a **Runner partagé**, a **Membre**) pays for a
**Moteur**: their own sign-in to it, where the provider allows it, or their
own API key, the only kind a **Projet d'équipe** uses. It stays on the
**Runner**; the product never holds it.
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
migration, an **Action sensible**. At the MVP the documents (PRD, Maquettes,
Conception technique, Inventaire) have the **Source** of the code, whose
repository holds them, and the **Idées** always live in Crewdeck.
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
**Conception** (PRD, mockups, technical design, Tickets) or an
**Amendement**, approve the
inventory of an existing repository, activate a changed **Process**, move a
**Type d'artefact** to another **Source**, invite a **Membre** or give them
an **Accès** with more **Droits** (and later release). Starting the
**Boucle**, or creating or resuming its **Planification**, also
confirms the merges it does itself, for the Tickets that pass their review,
until it is stopped or the **Planification** paused or deleted.
_Avoid_: action critique, action protégée

**Resynchronisation** (`Resync`):
The moment, after a lost connection, when the product rebuilds the state
and says so until it is sure again.
_Avoid_: rechargement, refresh

## Flagged ambiguities

- « rôle » of a person clashed with the **Rôle** of an agent: a person on a
  **Projet** has an **Accès**, made of **Droits**.
- « client » meant both the **Pilote**'s customer and a reader of the
  product: in the product, a client is a **Membre** with the **Accès**
  « Relecteur ».
- « approuver » by a client: a Relecteur gives an **Avis**; approving stays
  the gate of the **Pilote** or of a **Membre** allowed to.

- « grandes étapes » (Conception, Développement) clashed with **Étape**: the
  large blocks are **Phases**; an **Étape** stays the finer piece of work.
- « harness » was used for what runs an agent: it is a **Rôle**'s
  **Moteur**; an **Outil** is anything attached to an **Étape**.
- « Source des Idées » on the canvas: the **Idées** live in Crewdeck,
  encrypted, before they have a **Projet**; « Crewdeck » is shown, never
  chosen.
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
