# Collaboration — Crewdeck

> Ideas: DCCM-IDEA#35. Approved: <PR link> (<date>). Product: [prd.md](../prd.md).

## Problem

- Crewdeck is built for one person: one account is one **Pilote**, and
  nobody else can open their **Projets**. A developer who works for a client
  sends the PRD and the mockups by email or shows them in a call, and the
  client's feedback reaches the agents only once they rewrite it by hand.
- A team (developers, a product owner, a designer) cannot drive one
  **Projet** together: nobody else can note an **Idée**, comment on a
  document, read a **Session** or settle a **Décision** while the **Pilote**
  is away.
- What the **Pilote** shares must stay encrypted end to end (US-60): the
  orchestrators made for teams (Multica, Factory, Devin, Cursor, as of
  2026-11-19) keep everything readable on their servers.
- The agents of a team cannot run on one person's subscription: the
  providers' terms make a subscription personal, and nothing shared runs
  while every machine is off.
- Nothing records who did what: an approval, a merge or a change of the
  **Process** has no author once two people can make it.

## Users

| Role | What they come for here |
|---|---|
| **Pilote** | Owns the **Projet**, its **Runner** and its **Comptes IA**; invites **Membres**, gives each one an **Accès**, keeps the last word at the gates |
| **Membre** (**Accès** « Relecteur ») | A client of the **Pilote**: reads what is submitted to them, comments, gives their **Avis**, from the PC or the phone, with no GitHub account |
| **Membre** (**Accès** « Contributeur ») | Someone of the project team (a product owner, a designer): notes and triages **Idées**, comments anything, reads the **Sessions**, follows the **Boucle** |
| **Membre** (**Accès** « Co-pilote », « Administrateur ») | A developer of the team: drives **Sessions** and the **Boucle** on API keys, settles **Décisions**; the Administrateur also manages the **Membres** and the **Process** |

One account is one person: the **Pilote** of their own **Projets**, and
possibly a **Membre** of someone else's.

## Principles

- **The Pilote owns the Projet.** Deleting or transferring it, and their own
  **Runner** and **Comptes IA**, are never delegated; everything else is a
  **Droit** they may give.
- **No one grants what they do not have.** A **Membre** who manages the
  **Membres** gives only **Droits** they hold themselves.
- **The gate stays a gate.** A Relecteur's **Avis** informs the decision,
  never makes it; an **Action sensible** is confirmed by the core whoever
  asks for it, as for the **Pilote** (US-26).
- **A comment is not an instruction.** A comment reaches an agent only when
  the person who asks for changes sends it as the **Retour**, whatever the
  **Accès** of its author.
- **Shared, still encrypted.** What a **Membre** reads travels and is
  stored encrypted end to end; the server keeps only the state of the
  **Process**, as for a solo **Pilote** (US-60). Joining never waits for a
  machine of the **Pilote** to be on.
- **A subscription is personal, a team runs on API keys.** In a **Projet
  d'équipe**, every agent runs on an API key; a **Pilote**'s subscription
  serves only the **Projets** they drive alone.
- **Everything has an author.** Every action of a person, and of an agent on
  their behalf, is in the **Historique** of its **Projet**.

## Journeys

### Inviting and managing Membres
The Pilote invites a person by email onto one Projet with an Accès; the
link opens the Projet once that person signs in with the invited address.
The invitation carries what lets their browser read the Projet's encrypted
content, so no Appareil of the Pilote needs to be on when they join. A
Membre's next Appareil is approved from one of their own, as a Pilote's is.
- **US-124** (next) As a Pilote, I want to invite someone onto one of my Projets by email with an Accès, the invitation opening the Projet only once they sign in with the invited address, without waiting for one of my Appareils to be on, so that a client or a teammate joins in one click.
- **US-125** (next) As a Membre, I want to sign in with a link sent to my email, or with my Google or GitHub account, with no Runner nor Compte IA, and see only the Projets I was invited onto, next to my own if I am a Pilote too, so that joining costs me nothing.
- **US-126** (next) As a Pilote, I want to see the Membres of a Projet with their Accès, change an Accès and remove a Membre, a removed Membre losing access at once and the Projet's key changing, their comments and Avis staying with their name, so that I control who reads my work.
The four Accès by default give these Droits (✓); « Lire les Versions
soumises » comes with every Accès:

| Droit | Relecteur | Contributeur | Co-pilote | Administrateur |
|---|---|---|---|---|
| Commenter, rendre un Avis | ✓ | ✓ | ✓ | ✓ |
| Lire le Projet, lire les Sessions | | ✓ | ✓ | ✓ |
| Noter et trier des Idées | | ✓ | ✓ | ✓ |
| Piloter les Sessions, démarrer la Boucle | | | ✓ | ✓ |
| Approuver (document, revue visuelle, merge), trancher les Décisions | | | ✓ | ✓ |
| Modifier le Process ou une Source | | | | ✓ |
| Paramètres du Projet | | | | ✓ |
| Gérer les Membres | | | | ✓ |
| Lire l'Historique | | | | ✓ |

- **US-127** (next) As a Pilote, I want the four Accès by default, which never change, and to create my own by duplicating one and choosing its Droits among those of the table, my Accès defined in my account and offered on all my Projets, only I creating or changing them, a change applying at once to every Membre who holds that Accès, the product saying on how many Projets before I confirm, so that each person gets exactly the rights they need.
- **US-128** (next) As a Membre allowed to manage the Membres, I want to invite, change the Accès of and remove the Membres of that Projet, choosing among the Accès of its Pilote and never one with a Droit I do not hold, so that the Pilote can hand over the administration safely.

### A client's review
The Pilote submits a document of a Conception, a set of mockups or the
captures of a visual review to one or more Relecteurs. Each one reads a
Version soumise, fixed and stored encrypted, readable with every machine
off and without access to the Projet's Source; comments on it and gives an
Avis. The Pilote's approval stays the gate.
- **US-129** (next) As a Pilote, I want to submit a document of a Conception (PRD, technical design), a set of mockups or the captures of a visual review to one or more Relecteurs, as a Version soumise they read even when all my machines are off and they have no access to its Source, so that my client reviews exactly what I send.
- **US-130** (next) As a Relecteur, I want to comment on a passage of a document or on a zone of a mockup or a capture, on the PC or the phone, and give my Avis (« approuvé » or « changements demandés ») on the Version soumise I read, so that my feedback is precise and kept.
- **US-131** (next) As a Pilote, I want the Avis of the Relecteurs on the Décision of the review (« Avis client : approuvé par Claire, version 2 »), my approval staying the Action sensible that decides, and to submit the next version when the agent changed it, each Avis staying with the version it was given on, so that I decide knowing what my client thinks.
- **US-132** (next) As a Membre, I want my own « À toi » with what waits for me (a Version soumise to review, a Décision I may settle), with an email for a Relecteur and the Pilote's notifications for the other Accès, so that nobody waits for me without my knowing.
- **US-133** (next) As a Pilote, or a Membre allowed to approve, I want to choose, when I ask for changes, which comments of the Membres go to the agent as its Retour, all checked by default, so that a comment never becomes an instruction on its own.

### Working as a team
Contributeurs follow and feed the Projet without driving the agents;
Co-pilotes drive them on their own Runner or the Projet's Runner partagé,
always on API keys. A Projet d'équipe is a Projet where someone other than
its Pilote may drive the agents.
- **US-134** (next) As a Contributeur, I want to note and triage the Idées of a Projet, comment on its documents and Tickets, read its Sessions and follow its Boucle, so that the project team takes part without driving the agents.
- **US-135** (next) As a Co-pilote, I want to drive Sessions and start the Boucle of a Projet on my own Runner or on its Runner partagé, and settle its Décisions within my Droits, each Action sensible confirmed as for the Pilote, so that the team ships without waiting for the Pilote.
- **US-136** (next) As a Membre allowed to settle a Décision, I want it in the « À toi » of everyone who may settle it, the first answer settling it for all with the name of who answered, so that a Décision never waits for one person.
- **US-137** (next) As a Pilote, I want a Projet d'équipe to run its agents on API keys only, the product saying so when I give a Membre the Droit to drive them and showing which Comptes IA stay usable, a Session started on a subscription refused with why, so that no personal subscription serves a team.
- **US-138** (next) As a Pilote, I want to make a Runner on a server (US-70) the Runner partagé of a Projet, carrying only the API keys that I or a Membre allowed to change the Paramètres of the Projet put there for it, each key paid by whoever put it and named with them, where the Membres allowed to drive the agents run their Sessions and the Boucle, the spend counted per key and per person who started the work in the statistics, so that the team's agents work day and night with every PC off.
- **US-139** (next) As a Co-pilote, I want to be told why I cannot run the agents of a Local Projet whose folder is on the Pilote's own machine (« ce Projet vit sur la machine de Maxime »), and to run them once its folder is on its Runner partagé, so that a Projet without GitHub can still be driven by a team.
- **US-140** (next) As a Pilote or a Membre, I want to read a Session while its Runner is off, the Session stored encrypted as long as its Ticket or its Étape is open and 30 days after, so that everyone follows the agents whatever machine is on.

### Historique
Each Projet keeps who did what and when; an agent's action is credited to
the person who started it. The Journal des Décisions (US-78) stays the
place of the reasons, and now names who decided.
- **US-141** (next) As a Pilote, I want the Historique of each Projet for the Membres' arrival and their review (an invitation, an Accès given, changed or removed, a Version soumise, a comment, an Avis), with who, what and when, filterable by person and kind of action, readable with the Droit « lire l'Historique » and kept as long as the Projet, so that I know who said what to whom.
- **US-142** (next) As a Pilote, I want the Historique to hold every other action of a person (an approval, a merge, a start or a stop of the Boucle, a change of the Process or of a Source, a Décision settled) and every action of an agent credited to whoever started it (« Boucle démarrée par Inès »), so that once several people drive a Projet I know who did what.

## Scope

| Version | Contains | Done when |
|---|---|---|
| Bêta (`next`) | US-124 to US-126, US-129 to US-133, US-141: the **Accès** « Relecteur » only; invitation by email, the **Membres** of a **Projet**, the **Version soumise**, comments and **Avis**, the Retour chosen from the comments, the Membre's « À toi », the **Historique** of the review | the Bêta's success criterion below is met |
| Lancement (`next`) | US-127, US-128, US-134 to US-140, US-142, with US-31 of [prd.md](../prd.md) (the team's paid plan): the four **Accès** and the **Pilote**'s own, delegated administration, Contributeurs and Co-pilotes, **Décisions** shared, the **Projet d'équipe** on API keys, the **Runner partagé**, **Sessions** readable with the **Runner** off, the whole **Historique** | the Lancement's success criteria below are met |
| later | with US-32 of [prd.md](../prd.md): the **Runner** hosted by us, billed, on the team's API keys, or on the client's own infrastructure | — |

**Out**:
- A Relecteur's **Avis** approving in the **Pilote**'s place: the gate is
  the **Pilote**'s (or a **Membre**'s allowed to approve), so that what
  ships is decided by someone who answers for the **Projet**.
- A **Membre** running agents on the **Pilote**'s own **Runner** and its
  **Comptes IA**: the providers' terms make a subscription personal, and the
  **Pilote** would pay for someone else's work without seeing it. An API key
  the **Pilote** puts on the **Runner partagé** of a **Projet** is the
  exception they choose, named and counted (US-138).
- A **Projet** with **Membres** readable by our servers: what a team shares
  stays encrypted end to end, as a solo **Pilote**'s work does (US-60).
- Editing a document together inside Crewdeck: a document lives at its
  **Source** (one **Source** per artefact, [prd.md](../prd.md#principles));
  **Membres** comment, the agent or the **Source**'s tool edits.
- Inviting onto all of a **Pilote**'s **Projets** at once: a client sees only
  their **Projet**; to reopen for a team after the Lancement.
- Assigning a **Décision** to one person: the first one allowed answers
  (US-136); to reopen if a team asks for it.

## Success criteria

- Bêta: on 2 **Projets** done for clients, at least 80 % of the clients'
  **Avis** on a **Conception** or mockups are given in Crewdeck (not by email
  nor in a call), with a median under 48 h from the **Version soumise** to
  the **Avis**, measured by the **Historique**.
- Lancement: one **Projet** driven by 2 people (its **Pilote** and a
  Co-pilote or a Contributeur) for 4 consecutive weeks, both acting every
  week, measured by the **Historique**.
- Lancement: the **Boucle** of a **Projet d'équipe** merges Tickets on its
  **Runner partagé** during a night when no PC of a **Membre** is on,
  measured by its **Sessions**' history.
- No **Membre** ever reads what their **Accès** does not allow, proven by the
  product's tests on every **Droit** of US-127.

## Constraints

- Encryption end to end ([prd.md](../prd.md#principles), US-60): everything a
  **Membre** reads (an **Idée**, a comment, a **Version soumise**, a
  **Session**) is encrypted for them and never readable by our servers; the
  notifications and emails stay generic (« Une version attend ton avis »).
  This changes US-60 on one point: a **Session** is readable while its
  **Runner** is off once US-140 is done.
- AI providers' terms, read on 2026-11-08 ([prd.md](../prd.md#constraints)):
  a subscription is for its holder's use; a **Projet d'équipe** runs on API
  keys only (US-137), a **Pilote**'s subscription serving their solo
  **Projets** on their own machine.
- The product holds no AI credential: a **Runner partagé** is a machine of
  the **Pilote** or of the team. The **Runner** hosted by us (later, US-32)
  will hold the team's API keys in a machine billed to that team: a change
  of this principle, made only with it.
- GDPR: a **Membre**'s email is a third party's personal data that the
  **Pilote** hands us; a removed **Membre**'s comments and **Avis** stay with
  their name in the **Projet**, and deleting their account anonymises them.
- Relecteurs are free and unlimited for the **Pilote**; only the **Accès**
  that drive or administer may count in a paid plan (US-31).

## Open questions

- The price of the team's plan (per seat for the **Accès** that drive the
  agents or administer, or per **Projet d'équipe**): the founder, with the business
  model, before the Lancement.
- May a Co-pilote use their own subscription, on their own machine, for the
  **Sessions** they start in a **Projet d'équipe**? The providers' terms
  read on 2026-11-08 do not say; until a written answer, API keys only
  (US-137). The founder, with the letters of
  [prd.md](../prd.md#open-questions).
- Finer **Droits** (per **Étape**, per kind of **Décision**, read-only on
  the **Process**): once teams use the Lancement's list. The founder, after
  the Lancement.
- The hosted **Runner** (US-32): its price, the machines' location, and how
  a client hosts it on their own infrastructure. The founder, after the
  Lancement.
