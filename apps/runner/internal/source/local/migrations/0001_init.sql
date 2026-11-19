-- local.db v1 (SOURCE-2, ADR 0012): what the work writes on a Local Projet,
-- original data that no rebuild touches. The Tickets themselves are files of
-- the folder's `tickets/`; this holds what the files do not.

-- The counter shared by a Projet's Tickets and changes.
CREATE TABLE projects (
  project_id  TEXT PRIMARY KEY,
  next_number INTEGER NOT NULL DEFAULT 1
);

-- What a Ticket's file does not hold: its dates and its last content hash.
CREATE TABLE tickets (
  project_id   TEXT NOT NULL,
  number       INTEGER NOT NULL,
  path         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  closed_at    TEXT,
  content_hash TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (project_id, number)
);

-- A Ticket's comments, written by the agents (MIROIR-7) through the Runner.
CREATE TABLE comments (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  number     INTEGER NOT NULL,
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  session_id TEXT
);
CREATE INDEX comments_by_ticket ON comments (project_id, number, created_at);

-- The local changes of code (MIROIR-7, SOURCE-5): a branch of the folder
-- proposed for its integration branch.
CREATE TABLE changes (
  project_id       TEXT NOT NULL,
  number           INTEGER NOT NULL,
  title            TEXT NOT NULL,
  body             TEXT NOT NULL DEFAULT '',
  head_ref         TEXT NOT NULL,
  head_oid         TEXT NOT NULL DEFAULT '',
  base_ref         TEXT NOT NULL,
  state            TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed', 'merged')),
  is_draft         INTEGER NOT NULL DEFAULT 0,
  mergeable        TEXT,
  merge_commit_oid TEXT,
  author           TEXT NOT NULL,
  session_id       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  closed_at        TEXT,
  merged_at        TEXT,
  PRIMARY KEY (project_id, number)
);

CREATE TABLE reviews (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  number       INTEGER NOT NULL,
  author       TEXT NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('APPROVED', 'CHANGES_REQUESTED', 'COMMENTED')),
  body         TEXT NOT NULL DEFAULT '',
  commit_oid   TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL
);
CREATE INDEX reviews_by_change ON reviews (project_id, number, submitted_at);

CREATE TABLE review_comments (
  id         TEXT PRIMARY KEY,
  review_id  TEXT NOT NULL REFERENCES reviews (id),
  path       TEXT NOT NULL,
  line       INTEGER,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX review_comments_by_review ON review_comments (review_id, created_at);
