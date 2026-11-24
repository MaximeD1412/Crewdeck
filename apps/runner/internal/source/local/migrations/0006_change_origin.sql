-- local.db v6 (SOURCE-9): the origin marker of a change, and of a review, a
-- migration of the code copied from GitHub (`github#12`,
-- `github#12/review/<id>`), NULL for the others; found first by it, so a
-- copy resumed never writes one twice.
ALTER TABLE changes ADD COLUMN origin TEXT;
ALTER TABLE reviews ADD COLUMN origin TEXT;
