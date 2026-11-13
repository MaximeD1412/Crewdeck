# Sources: Local and GitHub, one per Type d'artefact, the Runner carrying Local

> **Status:** accepted, 2026-11-14. Amends [ADR 0003](0003-privacy-and-end-to-end-encryption.md)
> (what the server keeps of a Local Projet, content read through the
> relay), [ADR 0005](0005-contrats-as-data.md) (rules read Artefacts
> through the Miroir) and [ADR 0010](0010-the-runners-miroir.md) (the
> Miroir answers for every Source and carries the agents' writes).

## Context

Every Type d'artefact of a Projet has one Source, Local or GitHub at the
MVP ([feature PRD](../product/features/gestion-du-process.md), US-88,
US-99, US-102, US-103). A Projet with no Connecteur is complete: its
documents and Tickets are Markdown files of its folder, edited by hand and
on screen in under 2 s, while the product keeps the state of its work and
what the work writes stays on the machine. Moving a type to another Source
is an Action sensible that never leaves two Sources, not even for a moment.
The server never reads content ([ADR 0003](0003-privacy-and-end-to-end-encryption.md)),
and US-60 encrypts the titles of what lives only on the machine.

## Decision

### Which Source for what

- `artifact_sources` (`projectId`, `group`, `source` `local | github`,
  `since`) holds two choices per Projet:
  - `ticket`: the Tickets;
  - `code`: the Changement de code **and the documents** (PRD, Maquettes,
    Conception technique, Inventaire), which are files of the code's
    repository, reviewed on a branch and approved by its merge. The Sources
    panel shows them with the code's Source, without a menu of their own;
    a separate choice comes with a Connecteur of documents (Lancement).
- The Verdict lives where the Changement de code lives (a Review on its
  PR, or in the Miroir). The Livraison has no Source: it is the result of
  a Commande, in Crewdeck's state. The Idée's Source is « Crewdeck »,
  shown, never chosen: Idées are noted before their Projet (US-5) and stay
  encrypted in Crewdeck (ADR 0003).
- A Projet has at most one GitHub repository (`Project.repositoryId`),
  which holds every group on GitHub, and a folder on the Runner's machine
  when a group is Local. Its path stays on the Runner (`projects` of its
  state, `projectId` → path): the page sends it through the relay when the
  Pilote picks it (US-3), the server knows only that a folder exists.

### The Local folder

- **A git repository.** The Projet's preparation (US-4) offers « git init »
  and a first commit in one click when the folder has none.
- **The Runner's clone has the folder as `origin`**
  (`~/.crewdeck/repos/local/<projectId>`), and its worktrees are made as for
  GitHub ([ADR 0004](0004-the-runner.md)): never the Pilote's checkout. A
  Session's `git push` goes to the folder, where its branch appears.
- **A local Changement de code** is a branch and a record in the Miroir
  (number, title, body, head and base, state, its reviews and comments),
  numbered from the Projet's counter shared with its Tickets, as GitHub
  shares issues' and PRs'.
- **The merge**, bound to the SHA every Verdict judged
  ([ADR 0002](0002-github-app.md)): the Runner squashes the branch in its
  clone on the folder's integration head, then fast-forwards the folder:
  `git merge --ff-only` when the integration branch is checked out there,
  which git refuses only if the Pilote's uncommitted changes touch the
  same files; `git update-ref` with the old value otherwise. A refusal
  raises the Décision `merge.local-blocked` (« Merge en attente : tes
  modifications touchent les mêmes fichiers »), retried when the folder
  changes. A document of a Conception is approved the same way.
- **A Local Ticket** is `tickets/<n>-<slug>.md`:

  ```md
  ---
  number: 12
  title: Connexion par lien envoyé par e-mail
  state: open            # open | closed
  state_reason: null     # completed | not_planned, when closed
  ready: true
  labels: [priority:P1, size:S]
  blocked_by: [7, 9]
  parent: null
  milestone: M1
  ---

  The body, as plan-backlog writes it.
  ```

  Milestones are `tickets/milestones.yml` (`- title`, `due_on`). A file the
  Pilote adds without `number` gets the next one and its name. A file whose
  front matter does not parse is skipped and raises
  `ticket.local-unreadable`. The Runner writes Tickets in place, in the
  working tree, and never commits them: the folder's git history is the
  Pilote's.
- **What the work writes** (comments, review remarks, local changes'
  records) lives in the Miroir (`miroir.db`); `crewdeck-runner uninstall`
  warns that it goes with it.
- **Following the folder**: the Runner watches `tickets/` in the working
  tree and the integration branch's ref (fsnotify, 200 ms debounce), scans
  everything at start and every 60 s, and every 2 s for a folder on a
  Windows drive under WSL (`/mnt/<x>/`, no inotify). The documentation index
  of [ADR 0010](0010-the-runners-miroir.md) reads the integration branch's
  committed files, as on GitHub.

### What the server keeps of a Local Projet

- The same rows as for a GitHub Projet: `tickets` and `code_changes` with
  `source`, `number`, `state`, `stateReason`, `ready`, the product's labels
  (`priority:`, `size:`), `blockedBy`, `parent`, dates, verdicts and SHAs.
- Every text is sealed by the Runner under the vault key, as an Idée's
  ([ADR 0003](0003-privacy-and-end-to-end-encryption.md)): the Projet's
  name, the Tickets' and changes' titles, the milestones' titles and the
  other labels. The page decrypts them; a Runner offline leaves titles and
  states readable (US-60). Bodies, comments, remarks and diffs never leave
  the machine but through the relay.
- The Runner reports through its protocol `local.changed { projectId,
  items }` (identifiers, states, sealed texts, `contentHash`), written with
  their events in one transaction ([ADR 0007](0007-real-time.md)), the same
  latency measure as a webhook's.

### Reading content in the page

A document to review, a Ticket's body, a local diff or a Commande's output
of a Local Projet is read through the encrypted relay, as a Session
([ADR 0007](0007-real-time.md)): the tab asks `artifact.read { projectId,
kind: file | ticket | change | diff | command-output, ref }`, the Runner
answers encrypted for that tab, nothing is stored. The document reader of
`apps/web` gets this second fetcher beside GitHub's, behind the same
`@tanstack/query-core` keys. Runner offline: title and state.

### The agents' one channel, for every Source

- The `crewdeck-runner miroir` reads of [ADR 0010](0010-the-runners-miroir.md)
  answer for Local too, in gh's shapes: a Local Ticket as an issue, a local
  change as a PR (`headRefName`, `baseRefName`, `reviews`, and
  `statusCheckRollup` from its Commandes' checks).
- **Every write of an agent goes through the Miroir**:
  `miroir issue create|edit|comment|close|reopen` and `miroir pr
  create|edit|comment|review|close`, with gh's flags. On GitHub they call
  the API with the Session's token, then refresh the copy (what
  `crewdeck-runner gh` did); on Local they write the file or the Miroir's
  record, then report. The official Skills use `miroir` only; the `gh` shim
  stays in a GitHub Projet's Sessions for what has no `miroir` command.
- **Contrats** ([ADR 0005](0005-contrats-as-data.md)) read files in the
  worktree, as before, and Artefacts (the Découpage's Tickets, the `pr`
  rule's change) through the Miroir's view: one Contrat per Étape,
  whatever its Source.

### The Source wins (US-103)

- The Runner computes each Ticket's `contentHash` (HMAC-SHA256 of its title
  and body, keyed by a key derived from the vault key, so that it says
  nothing of the text) for both Sources. The StepRun that takes a Ticket
  keeps it; a different hash later shows « modifié depuis sa prise » and
  « Relancer ».
- A Ticket closed at its Source stops its PhaseRun: the Session is
  interrupted, its change closed with a comment (the PR on GitHub, the
  record on Local), its branch kept, the stop in its history. Reopened, a new
  PhaseRun starts from that branch.

### Moving a Source (US-102)

- The Action sensible `source.migrate` creates a `source_migrations` row
  (`projectId`, `group`, `from`, `to`, `state` `draining | copying |
  switching | done | failed`, counts, the error's code).
- **Draining**: no new PhaseRun that reads or writes the group starts; the
  running ones finish on the old Source.
- **Copying**, by the Runner, idempotent: each copy carries its origin
  (`<!-- crewdeck:from local#12 -->` at the end of an issue's body,
  `from: github#57` in a file's front matter), so that a retry reuses what
  it finds. Tickets keep their state and reason, labels, milestone,
  comments (one each, prefixed with their author and date), parents and
  blocked-by (set once all exist). Code to GitHub pushes every branch of
  the folder to a repository the Pilote created and installed the App on;
  code to Local clones the repository into an empty folder the Pilote
  picks. Documents move with the code, being its files.
- **Switching**, one server transaction: the Source, each Ticket's new
  number (the old one kept, shown « ex-#12 »), the event. Then the old
  place is frozen: `tickets/` renamed `tickets.archive-<YYYY-MM-DD>/`; issues
  labelled `crewdeck:archive` and locked, their state unchanged; a
  repository no longer followed.
- **Failure**: `failed`, the Décision `source-migration.failed`, the old
  Source stays the Source and the work resumes on it; « Réessayer » goes on
  from what was copied.

### Connecteurs beyond GitHub (Lancement)

A Connecteur runs on the Runner with its secrets. A tool that sends
webhooks sends them to the server, which keeps a content-free envelope for
the Runner as `github_changes` does (that table then generalised); a tool
that does not is polled by the Runner at the interval its Connecteur
declares, the delay it may have shown in the Sources panel. Their own
design settles the rest.

## Options that lost

- **Every type chosen apart at the MVP**: a PRD on Local with the code on
  GitHub would live on local branches never pushed, the folder and the
  repository diverging.
- **Idées as issues of the Projet's repository**: an Idée is noted before
  its Projet, and Idées are kept encrypted on purpose (ADR 0003).
- **The server keeping identifiers only for Local**: a Runner offline would
  show nothing, against US-60.
- **Copies of Local content pushed encrypted to the server**: storage for
  what the relay already serves.
- **The Runner working in the folder, or committing the Tickets**: the
  Pilote's uncommitted work under the agents' feet, and a history they did
  not write.
- **Each Skill handling each Source**: one Skill per Source and Étape,
  and Contrats that differ.
- **Closing archived issues**: thirty notifications and a false state.

## Consequences

- The Runner protocol gets `local.changed`, `artifact.read` and its
  answer, `merge.local`, `migration.copy`; the server gets
  `artifact_sources`, `source_migrations`, `source` and sealed titles on
  `tickets` and `code_changes`; the Actions sensibles `source.migrate`; the
  Décisions `merge.local-blocked`, `ticket.local-unreadable`,
  `source-migration.failed`, `project.folder-missing` (a folder gone, or
  another Runner linked).
- `apps/runner/internal/source/` holds one package per Source (`local/`,
  `github/`) behind one interface (read, write, watch, copy), used by the
  Miroir and the migration; a Connecteur of the Lancement is one more.
- Tests: a Local Projet is a temporary git repository; the fake server and
  the fake GitHub as before; a test per Manque-free migration path and per
  failure resumed.
- The first files to imitate: `apps/runner/internal/source/local/` (the
  watcher and the Ticket file), `apps/server/src/process/sources/`.
