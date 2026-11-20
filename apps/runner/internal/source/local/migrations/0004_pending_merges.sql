-- local.db v4 (SOURCE-5, ADR 0012): a merge of a local change the Pilote's
-- uncommitted work blocked (`git merge --ff-only` refused), retried by the
-- Runner while it waits. `files` is the JSON array of the paths git named,
-- which never leave the Runner (ADR 0003); `since` the first refusal at
-- that SHA.
CREATE TABLE pending_merges (
  project_id TEXT NOT NULL,
  number     INTEGER NOT NULL,
  sha        TEXT NOT NULL,
  files      TEXT NOT NULL DEFAULT '[]',
  since      TEXT NOT NULL,
  PRIMARY KEY (project_id, number)
);
