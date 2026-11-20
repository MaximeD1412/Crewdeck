-- local.db v5 (SOURCE-8): the origin marker of a comment a migration of
-- Source copied from GitHub (`github#57/comment/<id>`), NULL for the others;
-- found first by it, so a copy resumed never writes a comment twice.
ALTER TABLE comments ADD COLUMN origin TEXT;
