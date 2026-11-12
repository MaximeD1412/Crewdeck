---
id: MIROIR-5
title: "The Miroir's documentation index: the validated documents of each Projet, from the Runner's clone, reindexed when the integration branch moves"
epic: MIROIR
type: feature
priority: P1
size: S
milestone: M3 Sessions and preparing Projets
blocked_by: [MIROIR-6, RUNNER-9]
adr: [0010, 0004]
risques: [SEC-10]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0010, « The documentation index »: besides GitHub's objects, the **Miroir** indexes each **Projet**'s validated documents (`docs/**/*.md`, `backlog/**/*.md`, `design/DESIGN.md`, `AGENTS.md`, `CONTEXT.md`) as they are on `origin/<integration branch>`, read from the Runner's own clone after a `git fetch`, in FTS5, reindexed when that branch's head moves. An agent finds a decision or a glossary term with `crewdeck-runner miroir search --kind doc` instead of reading every file.

## Current state of the code

- Created by RUNNER-9: the Runner's clones `~/.crewdeck/repos/<owner>/<name>` (`git clone --filter=blob:none`, `git fetch origin` before each Session) through a `TokenSource`, in `apps/runner/internal/session/`.
- Created by MIROIR-3: `internal/mirror/` (the `search` FTS5 table with `kind = 'doc'` and `path`, `projects.integration_branch`); by MIROIR-4: the follower (`push` envelopes, the 15-min reconciliation, the `TokenSource` per repository); by MIROIR-6: `crewdeck-runner miroir search`.
- No index of documents.

## To do

- `apps/runner/internal/mirror/docs.go`:
  - `IndexDocs(ctx, repository) error`: `git fetch origin <integration branch>` in the Projet's clone (created as RUNNER-9 does when missing), with the « Miroir » token of the repository (MIROIR-4's `TokenSource`, through RUNNER-9's clone function); lists the files of `origin/<integration branch>` matching the globs (`git ls-tree -r --name-only`, `github.com/bmatcuk/doublestar/v4` already in `go.mod`); reads each with `git show <sha>:<path>`; in one transaction replaces the Projet's `docs` rows (new table `docs(repository, path, blob_sha, title)`, `title` the file's first `# ` heading or its path) and their `search` rows (`kind = 'doc'`, `path`, `title`, `content`), and stores the indexed head in `projects.docs_head`. A file whose blob did not change is not reread.
  - Bump `SchemaVersion` (a rebuild refills the copy).
- The follower (MIROIR-4) calls it: on a `push` envelope whose `ref` is `refs/heads/<integration branch>`; at each reconciliation when `git ls-remote origin <integration branch>` differs from `docs_head`; when a Projet is added or its integration branch changes.
- `search --kind doc` (MIROIR-6) returns these rows with their `path`; without `--kind` they come with the others.

## Decisions already made

- The globs are exactly the ADR's; no other file's content is copied (ADR 0010).
- The Runner's clone is shared with the Sessions (RUNNER-9): a fetch of the integration branch never touches a Session's worktree; every git operation on a clone takes a per-clone lock (RUNNER-9's if it has one, else added here to its clone code and used by both).
- The token reaches git in the git process's environment only (`GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=http.https://github.com/.extraheader`, `GIT_CONFIG_VALUE_0=Authorization: Basic <base64 of x-access-token:<token>>`, `GIT_TERMINAL_PROMPT=0`), readable by the Pilote's user only like the token in memory; never in the remote URL, a file nor a process's arguments.
- A failed fetch keeps the previous index and counts as a failed fetch for the Projet's freshness (MIROIR-4).

## Acceptance criteria

- [ ] A Projet's `docs/adr/0001-x.md`, `AGENTS.md` and `backlog/issues/A-1.md` are indexed; `src/readme.md` and `design/screens.json` are not (local bare repository over `file://`).
- [ ] `search "Miroir" --kind doc` finds the document with its path and title.
- [ ] A `push` envelope on the integration branch reindexes it; one on another branch does not.
- [ ] An unchanged file is not reread on a reindex (counted on the git calls).
- [ ] The reconciliation reindexes when the branch moved without an envelope.

## Verification

- `cd apps/runner && go test ./internal/mirror/ -run Docs`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The Runner's clones: RUNNER-9. A Session's git credentials: RUNNER-10. Searching: MIROIR-6.

## Dependencies

- MIROIR-6, RUNNER-9.
