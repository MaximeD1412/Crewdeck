-- local.db v2 (SOURCE-3, ADR 0012, « Following the folder »): what the
-- Runner last reported to the server of each item of a Local Projet, so that
-- a report sends only what changed. `digest` is an HMAC of the item's
-- plaintext under a key derived from the vault key (a rotation changes
-- every digest, and every item is sent again, sealed under the new key);
-- `item` is the item as sent, its texts sealed, sent again as it is in a full
-- report. Rows are written once the send succeeded.
CREATE TABLE reported (
  project_id TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('ticket', 'milestone', 'change', 'unreadable')),
  id         TEXT NOT NULL,
  digest     TEXT NOT NULL,
  item       TEXT NOT NULL,
  PRIMARY KEY (project_id, kind, id)
);
