---
id: SOURCE-9
title: "Migrating the code and its documents between Local and GitHub, and picking the new place: a repository with the App installed, or a folder of the machine"
epic: SOURCE
type: feature
priority: P2
size: M
milestone: M7 Statistics and switchover
blocked_by: [SOURCE-8, PROJET-6]
adr: [0012, 0002]
risques: []
stories: [US-102]
screens: []
revue_visuelle: false
video: false
---

## Context

US-102 for the `code` group: the Changement de code and the documents (PRD, Maquettes, Conception technique, Inventaire), which are files of the code's repository (ADR 0012, « Which Source for what »). ADR 0012 (« Moving a Source »): code to GitHub pushes every branch of the folder to a repository the Pilote created and installed the App on; code to Local clones the repository into an empty folder the Pilote picks; documents move with the code. Leaving GitHub, the product writes nothing more there, and the repository stays followed while the Tickets are on GitHub; leaving Local, the folder is left as it is (the Pilote's checkout). SOURCE-7 refuses a migration whose new place does not exist yet (`source.target-missing`); this ticket lets the Pilote pick it, for both groups, so that a Projet created Local can move to GitHub and back.

## Current state of the code

- `apps/server/src/github/github.client.ts` (`GitHubClient`), the fake GitHub `apps/server/src/testing/fake-github.ts`.
- Created by SOURCE-7: `source_migrations`, `POST /api/projects/:id/sources/:group/migrate { to, seq }` and its 422 `source.target-missing`, the protocol `migration.*`, `hello.migrations`, `registerSwitchHook`, the dialog and its per-group sentences. Created by SOURCE-8: `POST /api/runner/source-migrations/:id/github-token` (`issues: write`), `apps/runner/internal/migration/` (progress file, verify passes, fingerprints, freeze then late changes), `apps/runner/internal/source/github/`, the `ticket` switch hook.
- Created by PROJET-2: `Repository`, `Project.repositoryId`, the repository picker (`repository` events, the installation's repositories). Created by PROJET-6: `Project` repository columns nullable, the folder typed in a TextField and checked live through the relay (`folder.check { path }` → exists, isGit, hasCode), the path kept only in the Runner's state (`projects`), « git init » offered.
- Created by SOURCE-2: the Runner's clone `~/.crewdeck/repos/local/<projectId>` with the folder as `origin`, `local.db` (local changes' records). Created by SOURCE-5: the local change of code record and `merge.local`. Created by BOUCLE-1: `code_changes` with `source`, the PR handlers and the reconciliation. Created by MIROIR-1: `mirror.projects` (the Projets the Runner copies from GitHub). Created by MIROIR-5: the documentation index of the integration branch.
- Created by CORE-11: 409 `github.not-linked` for a route needing GitHub, « Relier GitHub ».

## To do

- **Picking the new place** in SOURCE-7's dialog, when the Projet has none:
  - to GitHub: a `Select` « Dépôt » of the installation's repositories that no Projet follows, with the help « Crée le dépôt sur GitHub, installe l'App Crewdeck dessus, puis choisis-le ici. » and a link to the App's installation; none yet: an `Empty` with that link. A Pilote without GitHub gets CORE-11's « Relier GitHub ».
  - to Local: PROJET-6's TextField « Dossier » checked live by the Runner; for `code` the folder must exist and be empty (`folder.check` gains `empty`), « Ce dossier n'est pas vide : le dépôt y sera cloné. »; for `ticket` it must be a git repository, « git init » offered as at creation. The path goes to the Runner through the relay as PROJET-6's, kept as the Projet's pending folder until the switch, dropped on failure.
  - the route's body gains `target?: { repositoryId } | { folder: true }`; `source_migrations.targetRepositoryId?`; 422 `source.repository-followed` (another Projet follows it), `source.repository-not-empty` (for `code`: it has a branch, read with the App), `source.folder-not-picked` (the Runner holds no pending folder for this Projet). `Project.repositoryId` is set at the switch, never before.
- **Token**: SOURCE-8's route also gives, for `group: code`, `contents: write`, `pull_requests: write`, `workflows: write` on that repository.
- **Runner** `apps/runner/internal/migration/code.go`, `group: code` (`hello.migrations` lists `code`):
  - **Local → GitHub**: fetch every branch of the folder into the Runner's clone, push them to the repository, the release branch first (it becomes its default branch); each open local change of code becomes a PR (head, base, title, body ending with `<!-- crewdeck:from local#<n> -->`, draft kept, its comments and review remarks one comment each, « **<auteur>**, le <date> : »), found first by its marker; closed and merged records are not copied, their branches are.
  - **GitHub → Local**: clone the repository into the picked folder, a local branch for each remote branch, the integration branch checked out; each open PR becomes a local change record in `local.db` (numbered from the Projet's counter, `from: github#<n>`, its comments and reviews); the Runner's clone `~/.crewdeck/repos/local/<projectId>` made with the folder as `origin`.
  - **Verifying**: each branch's SHA and each open change's state, head and `contentHash` compared between the two places, recopied until a pass finds no difference; fingerprints `branch:<name>` and `change:<local|github>#<n>`.
  - **Finishing**: leaving Local, nothing is frozen; leaving GitHub, the product writes nothing more there. Then the late commits are carried: a branch moved on the old place since the last pass is fast-forwarded on the new one (pushed to GitHub, or `git update-ref` with the old value in the folder, `git merge --ff-only` for the checked-out branch); one that is not a fast-forward fails the stage `finish` with `branch.diverged` (SOURCE-7's `unfinished`). Then the Runner's code Source of the Projet switches (worktrees, Miroir, documentation index rebuilt from the new place), the old clone `~/.crewdeck/repos/local/<projectId>` removed when leaving Local.
- **Server** `apps/server/src/process/sources/migrations/code.switch.ts`, the `code` hook: `code_changes` renumbered (`formerNumber`, `formerSource`, `source`), `Project.repositoryId` set (to GitHub) or the Projet's folder marked as existing (to Local), events; at `done`, leaving GitHub while the `ticket` Source is not GitHub: `Project.repositoryId` cleared, the repository dropped from `mirror.projects`, its webhooks ignored (the App stays installed: the Pilote uninstalls it on GitHub).
- The dialog's sentences for the group: « Puis les <n> branches du dossier sont poussées sur <owner>/<name> et les <m> changements ouverts deviennent des PR, d'un coup. », « Les documents (PRD, Maquettes, Conception technique, Inventaire) suivent : ce sont des fichiers du code. », « Le dossier reste tel quel : c'est ton checkout. »; back: « Puis <owner>/<name> est cloné dans <dossier>, toutes ses branches, et les <m> PR ouvertes deviennent des changements locaux. », « Crewdeck n'écrit plus rien sur GitHub » with « ; le dépôt reste suivi tant que les Tickets y sont. » when they are.
- Tests: Go with temporary git repositories (a bare one standing for GitHub's remote, an `httptest` GitHub API for the PRs); the server's hook, the route's new 422s, the unfollow at `done` (integration, fake GitHub).

## Decisions already made

- The Pilote creates the repository and installs the App: Crewdeck never creates a repository (ADR 0002: the App's permissions are on what the Pilote installs it on).
- The repository must have no branch for `code`: pushing onto someone's history would merge two histories nobody chose. For `ticket` an existing repository is fine.
- Code to Local needs an empty folder; a folder holding the Pilote's own checkout of that repository is not reused, so that the clone is exactly the repository's.
- Branches are pushed as they are, never rebased nor squashed; tags are not migrated at the MVP.
- Leaving GitHub never deletes nor archives the repository: « the product writes nothing more there ».
- A Projet with both groups on the same side has at most one repository and one folder (ADR 0012): moving `code` to GitHub on a Projet whose Tickets are already there reuses that repository, no pick.

## Acceptance criteria

- [ ] A Local Projet picks an empty repository with the App installed; the migration pushes every branch (release first) and turns two open local changes into two PRs with their comments; `Project.repositoryId` is set at the switch; a retry after a failure pushes nothing twice and opens no duplicate PR.
- [ ] A repository with a branch is refused 422 `source.repository-not-empty`; one followed by another Projet 422 `source.repository-followed`.
- [ ] A GitHub Projet picks an empty folder; the migration clones every branch into it, turns open PRs into local changes, and the Runner's clone has the folder as `origin`; a non-empty folder is refused by the live check.
- [ ] A commit pushed to a branch of the old place between the last pass and the freeze reaches the new place; a diverged branch raises « Migration de Source inachevée ».
- [ ] Leaving GitHub with the Tickets Local unfollows the repository at `done`; with the Tickets on GitHub it stays followed.
- [ ] After the switch, a document of a Conception (`docs/product/prd.md`) is read from the new place by the Miroir's documentation index.
- [ ] The token for `code` carries `contents`, `pull_requests` and `workflows` write on that repository only (fake GitHub's recorded call).

## Verification

- `cd apps/runner && go test ./internal/migration/ -run Code`
- `pnpm exec nx test server -- src/process/sources/migrations/code.switch.spec.ts`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- source-migrations`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

A migration (column `source_migrations.target_repository_id`). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- The migration's state machine, draining, the switch and the page: SOURCE-7. The Tickets' copy: SOURCE-8.
- Creating a Projet from a folder or a repository: PROJET-2, PROJET-6.

## Dependencies

- SOURCE-8
- PROJET-6
