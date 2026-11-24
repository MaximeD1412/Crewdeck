-- SOURCE-9: the repository the Pilote picked for a group moving to GitHub from a Projet without one.
ALTER TABLE "source_migrations" ADD COLUMN     "target_repository_id" UUID;

-- SOURCE-9: a change of code's number and Source before a migration of the code moved it.
ALTER TABLE "code_changes" ADD COLUMN     "former_number" INTEGER,
ADD COLUMN     "former_source" "ticket_source";

-- A change of code a migration just moved has no title until its new Source fills it (the
-- reconciliation to GitHub, the Runner's report to Local): neither readable nor sealed.
ALTER TABLE "code_changes" DROP CONSTRAINT "code_changes_title_by_source";
ALTER TABLE "code_changes" ADD CONSTRAINT "code_changes_title_by_source" CHECK (
  ("source" = 'github' AND "title" IS NOT NULL AND "title_sealed" IS NULL)
  OR ("source" = 'local' AND "title" IS NULL AND "title_sealed" IS NOT NULL)
  OR ("former_source" IS NOT NULL AND "former_source" <> "source" AND "title" IS NULL AND "title_sealed" IS NULL)
);

-- A Projet followed from GitHub whose groups all moved Local: no repository any more, a folder,
-- and its name still the readable one it had (it was never sealed).
ALTER TABLE "projects" DROP CONSTRAINT "projects_github_or_local";
ALTER TABLE "projects" ADD CONSTRAINT "projects_github_or_local" CHECK (
  (repository_id IS NOT NULL AND display_name IS NOT NULL)
  OR (folder_state IS NOT NULL AND (name_sealed IS NOT NULL OR display_name IS NOT NULL))
);
