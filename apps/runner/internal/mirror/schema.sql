-- The Miroir's copy (ADR 0010), the reference the agents' `sql` reads.
-- Written only from what GitHub answers; enums as GitHub's GraphQL spells
-- them (OPEN, MERGED, NOT_PLANNED, CONFLICTING…), as `gh --json` prints them;
-- dates as GitHub gives them (ISO 8601, UTC), null when GitHub has none.
-- A `repository` is `<owner>/<name>`.

-- The Runner's own values: `mirror_after`, the last github_changes.seq applied.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- The Pilote's Projets, as the server names them (mirror.projects).
CREATE TABLE projects (
  repository         TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL,
  github_repo_id     INTEGER NOT NULL,
  installation_id    INTEGER NOT NULL,
  display_name       TEXT NOT NULL,
  integration_branch TEXT NOT NULL,
  filled_at          TEXT, -- the end of its first complete reconciliation
  synced_at          TEXT  -- its last applied envelope or reconciliation
);

-- Issues and PRs (is_pull = 1), one numbering per repository.
CREATE TABLE issues (
  repository       TEXT NOT NULL,
  number           INTEGER NOT NULL,
  is_pull          INTEGER NOT NULL,
  title            TEXT NOT NULL,
  body             TEXT NOT NULL,
  state            TEXT NOT NULL, -- OPEN, CLOSED, MERGED
  state_reason     TEXT,          -- COMPLETED, NOT_PLANNED, REOPENED, DUPLICATE
  url              TEXT NOT NULL,
  author           TEXT,          -- a login, null for a deleted account
  milestone_number INTEGER,
  created_at       TEXT,
  updated_at       TEXT,
  closed_at        TEXT,
  PRIMARY KEY (repository, number)
);

CREATE TABLE issue_labels (
  repository TEXT NOT NULL,
  number     INTEGER NOT NULL,
  name       TEXT NOT NULL,
  PRIMARY KEY (repository, number, name),
  FOREIGN KEY (repository, number) REFERENCES issues (repository, number) ON DELETE CASCADE
);

CREATE TABLE issue_assignees (
  repository TEXT NOT NULL,
  number     INTEGER NOT NULL,
  login      TEXT NOT NULL,
  PRIMARY KEY (repository, number, login),
  FOREIGN KEY (repository, number) REFERENCES issues (repository, number) ON DELETE CASCADE
);

-- The comments of an issue or a PR (not a review's), `id` GitHub's node id.
CREATE TABLE comments (
  repository TEXT NOT NULL,
  number     INTEGER NOT NULL,
  id         TEXT NOT NULL,
  author     TEXT,
  body       TEXT NOT NULL,
  url        TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  PRIMARY KEY (repository, id),
  FOREIGN KEY (repository, number) REFERENCES issues (repository, number) ON DELETE CASCADE
);
CREATE INDEX comments_by_object ON comments (repository, number);

-- Written by the parent's fetch, in its order (`position` from 0); a child's
-- fetch only names its parent, without a position. Both in `repository`.
CREATE TABLE sub_issues (
  repository TEXT NOT NULL,
  parent     INTEGER NOT NULL,
  child      INTEGER NOT NULL,
  position   INTEGER,
  PRIMARY KEY (repository, parent, child)
);
CREATE INDEX sub_issues_by_child ON sub_issues (repository, child);

-- Written by the blocked issue's fetch; a blocker may be in another repository.
CREATE TABLE blocked_by (
  repository         TEXT NOT NULL,
  number             INTEGER NOT NULL,
  blocker_repository TEXT NOT NULL,
  blocker_number     INTEGER NOT NULL,
  PRIMARY KEY (repository, number, blocker_repository, blocker_number)
);
CREATE INDEX blocked_by_blocker ON blocked_by (blocker_repository, blocker_number);

CREATE TABLE pulls (
  repository       TEXT NOT NULL,
  number           INTEGER NOT NULL,
  head_ref         TEXT NOT NULL,
  head_oid         TEXT NOT NULL,
  base_ref         TEXT NOT NULL,
  is_draft         INTEGER NOT NULL,
  mergeable        TEXT,  -- MERGEABLE, CONFLICTING, UNKNOWN
  merge_commit_oid TEXT,
  merged_at        TEXT,
  checks_state     TEXT,  -- the rollup's state of head_oid as the PR was read: SUCCESS, FAILURE, PENDING…
  PRIMARY KEY (repository, number),
  FOREIGN KEY (repository, number) REFERENCES issues (repository, number) ON DELETE CASCADE
);

CREATE TABLE pull_commits (
  repository TEXT NOT NULL,
  number     INTEGER NOT NULL,
  position   INTEGER NOT NULL,
  oid        TEXT NOT NULL,
  message    TEXT NOT NULL,
  PRIMARY KEY (repository, number, position),
  FOREIGN KEY (repository, number) REFERENCES issues (repository, number) ON DELETE CASCADE
);

CREATE TABLE closing_issues (
  repository       TEXT NOT NULL,
  number           INTEGER NOT NULL,
  issue_repository TEXT NOT NULL,
  issue_number     INTEGER NOT NULL,
  PRIMARY KEY (repository, number, issue_repository, issue_number),
  FOREIGN KEY (repository, number) REFERENCES issues (repository, number) ON DELETE CASCADE
);

CREATE TABLE reviews (
  repository   TEXT NOT NULL,
  number       INTEGER NOT NULL,
  id           TEXT NOT NULL,
  author       TEXT,
  state        TEXT NOT NULL, -- APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, PENDING
  body         TEXT NOT NULL,
  commit_oid   TEXT,
  submitted_at TEXT,
  PRIMARY KEY (repository, id),
  FOREIGN KEY (repository, number) REFERENCES issues (repository, number) ON DELETE CASCADE
);

CREATE TABLE review_comments (
  repository TEXT NOT NULL,
  number     INTEGER NOT NULL,
  id         TEXT NOT NULL,
  review_id  TEXT,
  author     TEXT,
  body       TEXT NOT NULL,
  path       TEXT NOT NULL,
  line       INTEGER,
  created_at TEXT,
  PRIMARY KEY (repository, id),
  FOREIGN KEY (repository, number) REFERENCES issues (repository, number) ON DELETE CASCADE
);

-- The check runs and commit statuses of a commit (statusCheckRollup.contexts).
-- A StatusContext's context is its name, its state its conclusion.
CREATE TABLE checks (
  repository   TEXT NOT NULL,
  sha          TEXT NOT NULL,
  typename     TEXT NOT NULL, -- CheckRun, StatusContext
  name         TEXT NOT NULL,
  status       TEXT,          -- QUEUED, IN_PROGRESS, COMPLETED… (CheckRun)
  conclusion   TEXT,          -- SUCCESS, FAILURE… (CheckRun); SUCCESS, PENDING, FAILURE, ERROR (StatusContext)
  details_url  TEXT,
  started_at   TEXT,
  completed_at TEXT,
  PRIMARY KEY (repository, sha, typename, name)
);

-- The commits whose checks were read, with the rollup's state they were read
-- at: written with the checks, so that a read that failed is read again.
CREATE TABLE checks_read (
  repository TEXT NOT NULL,
  sha        TEXT NOT NULL,
  state      TEXT,
  PRIMARY KEY (repository, sha)
);

CREATE TABLE repo_labels (
  repository  TEXT NOT NULL,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  description TEXT,
  PRIMARY KEY (repository, name)
);

CREATE TABLE milestones (
  repository  TEXT NOT NULL,
  number      INTEGER NOT NULL,
  title       TEXT NOT NULL,
  state       TEXT NOT NULL, -- OPEN, CLOSED
  description TEXT,
  due_on      TEXT,
  PRIMARY KEY (repository, number)
);

CREATE TABLE releases (
  repository    TEXT NOT NULL,
  tag           TEXT NOT NULL,
  name          TEXT,
  body          TEXT,
  is_draft      INTEGER NOT NULL,
  is_prerelease INTEGER NOT NULL,
  created_at    TEXT,
  published_at  TEXT,
  PRIMARY KEY (repository, tag)
);

-- Full-text search: an issue or PR (title, body), a comment, a review or a
-- review comment (kind 'comment', the object's title), a document (MIROIR-5).
CREATE VIRTUAL TABLE search USING fts5 (
  kind UNINDEXED,       -- issue, comment, doc
  repository UNINDEXED,
  number UNINDEXED,     -- null for a doc
  path UNINDEXED,       -- a doc's path, null otherwise
  title,
  content
);
