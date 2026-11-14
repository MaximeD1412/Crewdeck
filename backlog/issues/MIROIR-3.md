---
id: MIROIR-3
title: "The Miroir's store: miroir.db, its versioned schema, an issue or PR fetched from GitHub with its parts, and a Projet's reconciliation"
epic: MIROIR
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: []
adr: [0010, 0004, 0003]
risques: [SEC-10]
stories: [US-60]
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0010, « Where it lives » and « How it follows GitHub »: the **Miroir** is `~/.crewdeck/miroir.db`, one SQLite database for every **Projet** of the **Pilote**, written only from what GitHub answers. This ticket is its store and the two ways it is filled: fetching one object (an issue or a PR with everything the Miroir keeps of it, or the checks of a commit) and a Projet's reconciliation (every issue and PR by pages, its labels, milestones and releases). It is the « first file to imitate » the ADR names (`apps/runner/internal/mirror/`). MIROIR-4 drives it from the server's envelopes, MIROIR-5 adds the documentation index, MIROIR-6 the agents' commands. The copy holds the Projets' content on the Pilote's disk (risk SEC-10).

## Current state of the code

- `apps/runner/internal/state/state.go`: `state.Default()`, the Runner's folder `$CREWDECK_HOME` or `~/.crewdeck` (mode 700), files written mode 600.
- `apps/runner/internal/github/pulls.go`: the Runner's REST reader of a PR's facts (`Client{ BaseURL, HTTP, Tokens TokenSource }`, `TokenSource.Token(ctx)`), tested with `httptest`; no GraphQL, no fake package.
- `apps/runner/internal/logging/logging.go`: the JSON logger, redacting attributes that may carry a text.
- `apps/runner/go.mod`: no SQLite driver.
- No `internal/mirror/`.

## To do

- `go.mod`: `modernc.org/sqlite` (pure Go, FTS5 included: the binaries stay static and cross-compiled, ADR 0010).
- `apps/runner/internal/mirror/store.go`:
  - `Open(path string) (*Store, error)`: creates the file mode 600 before opening it, `PRAGMA journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON`; the `-wal` and `-shm` files chmod 600 once created. `DefaultPath()` = `<state dir>/miroir.db`.
  - `SchemaVersion` (an int, 1) kept in `PRAGMA user_version`; a database of another version is dropped and recreated (`Rebuild`), every Projet back to unfilled.
  - `OpenReadOnly(path)`: `mode=ro`, `PRAGMA query_only=ON`, for MIROIR-6's reads.
  - `Rebuild() error`, `Close() error`.
- `apps/runner/internal/mirror/schema.sql` (embedded, the reference the agents' `sql` reads): `meta(key PK, value)` (`mirror_after`, the cursor of MIROIR-4); `projects(repository PK '<owner>/<name>', project_id, github_repo_id, installation_id, display_name, integration_branch, filled_at, synced_at)`; `issues(repository, number, is_pull, title, body, state, state_reason, url, author, milestone_number, created_at, updated_at, closed_at, PK(repository, number))`; `issue_labels(repository, number, name)`; `issue_assignees(repository, number, login)`; `comments(repository, number, id, author, body, url, created_at, updated_at)`; `sub_issues(repository, parent, child, position)`; `blocked_by(repository, number, blocker_repository, blocker_number)`; `pulls(repository, number, head_ref, head_oid, base_ref, is_draft, mergeable, merge_commit_oid, merged_at)`; `pull_commits(repository, number, position, oid, message)`; `closing_issues(repository, number, issue_repository, issue_number)`; `reviews(repository, number, id, author, state, body, commit_oid, submitted_at)`; `review_comments(repository, number, id, review_id, author, body, path, line, created_at)`; `checks(repository, sha, typename 'CheckRun'|'StatusContext', name, status, conclusion, details_url, started_at, completed_at, PK(repository, sha, typename, name))`; `repo_labels(repository, name, color, description)`; `milestones(repository, number, title, state, description, due_on)`; `releases(repository, tag, name, body, is_draft, is_prerelease, created_at, published_at)`; FTS5 `search(kind 'issue'|'comment'|'doc', repository, number, path, title, content)`. Enums kept as GitHub's GraphQL spells them (`OPEN`, `MERGED`, `NOT_PLANNED`, `CONFLICTING`…), which is what `gh --json` prints.
  - `PutObject(tx, Object)`: one transaction that replaces every row of the object (issue or PR) and its `search` rows; `DeleteObject(tx, repository, number)`; `PutChecks(tx, repository, sha, []Check)`; `PutCollections(tx, repository, labels, milestones, releases)`; `PutProjects(projects)` (adds, updates, and deletes every row of a repository no longer a Projet); `MarkFilled(repository, at)`, `MarkSynced(repository, at)`.
- `apps/runner/internal/mirror/fetch.go`, GitHub's GraphQL API (`https://api.github.com/graphql`, `BaseURL` overridable) with a `TokenSource` per repository:
  - `FetchObject(ctx, repository, number) (Object, error)`: query `MirrorObject` on `repository.issueOrPullRequest(number:)`, fragments for `Issue` (title, body, state, stateReason, url, author, labels, assignees, milestone, comments, `parent`, `subIssues`, `blockedBy`, dates) and `PullRequest` (the same, plus headRefName, headRefOid, baseRefName, isDraft, mergeable, mergeCommit, closingIssuesReferences, commits with their message, reviews, review threads' comments, merged). Nested connections `first: 100`; one with `hasNextPage` is completed by its own paged query. `null` (deleted, transferred) → `ErrGone`, which the caller turns into `DeleteObject`.
  - `FetchChecks(ctx, repository, sha) ([]Check, error)`: query `MirrorChecks` on `object(oid:)` as `Commit`, `statusCheckRollup.contexts(first: 100)` with `CheckRun` (name, status, conclusion, detailsUrl, dates) and `StatusContext` (context as name, state as conclusion, targetUrl).
  - `FetchCollections(ctx, repository)`: labels, milestones, releases, all pages.
  - Errors: 401 and 403 without a rate limit → `ErrRefused`; 403 or 429 with `Retry-After` or `X-RateLimit-Remaining: 0` → `*LimitedError{ RetryAt }`; 5xx and network errors → `ErrUnavailable`. No error message carries a body.
- `apps/runner/internal/mirror/reconcile.go`: `Reconcile(ctx, repository) (Result, error)`: walks `repository.issues` and `repository.pullRequests` (`first: 100`, `orderBy: UPDATED_AT DESC`, every state) with light fields (`number`, `updatedAt`, for open PRs `headRefOid` and the rollup's `state`, for open issues their `blockedBy` numbers); fetches with `FetchObject` each object absent from the copy or whose light fields differ, the checks of an open PR whose head changed, then deletes the copy's objects absent from the complete walk, and rereads the collections. On an empty copy the same walk fills it; `MarkFilled` once it finished.
- `apps/runner/internal/github/githubtest/`: a fake GitHub (`httptest`) answering GraphQL by `operationName` and variables from fixtures in `testdata/graphql/`, REST by path, scripted errors (401, a rate limit, 502), recording each call with its `Authorization` header.

## Decisions already made

- GraphQL for the objects: `gh issue view --json` and `gh pr view --json` read GraphQL, so the fields, their names and their enums are already the ones MIROIR-6 prints. If a field this ticket names is missing from GitHub's GraphQL schema (check the docs, never an introspection from a test), the REST equivalent is used (blocked-by: `GET /repos/{owner}/{repo}/issues/{number}/dependencies/blocked_by`, as the server's `listIssueDependencies`).
- Each relation is stored with the side whose fetch rewrites it: sub-issues with the parent, blocked-by with the blocked issue (the envelopes of MIROIR-1 name those sides).
- Not copied: diffs, files, captures, workflow runs and logs (ADR 0010).
- The database is never in a log, an error message or a crash report; a log line names a repository, a number, a kind and a duration, never a title nor a body (SEC-10).
- One writer: the running Runner (MIROIR-4). Readers open their own read-only connection (WAL).

## Acceptance criteria

- [ ] `Open` creates `miroir.db` (and its WAL files) mode 600; a database of an older `SchemaVersion` is rebuilt empty.
- [ ] `FetchObject` of an issue stores its fields, labels, assignees, milestone, comments, parent, sub-issues and blocked-by; of a PR also its branches, head, draft, mergeable, merge commit, closing issues, commits, reviews and review comments (fake GitHub fixtures).
- [ ] A comment list of more than 100 is completed by its paged query.
- [ ] Fetching a deleted or transferred issue removes it, its relations and its `search` rows.
- [ ] `FetchChecks` stores the check runs and the commit statuses of a SHA.
- [ ] `Reconcile` on an empty copy fills it and marks the Projet filled; on a full copy it fetches only the changed objects (calls counted on the fake) and removes an object GitHub no longer lists.
- [ ] A rate limit answers `LimitedError` with its `RetryAt`; 401 `ErrRefused`; 502 `ErrUnavailable`.
- [ ] The Runner's log during these tests contains no title nor body of the fixtures.

## Verification

- `cd apps/runner && go test ./internal/mirror/ ./internal/github/...`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- Following the envelopes, the token, the backoff and the freshness: MIROIR-4. The documentation index: MIROIR-5. The commands: MIROIR-6.

## Dependencies

- None.
