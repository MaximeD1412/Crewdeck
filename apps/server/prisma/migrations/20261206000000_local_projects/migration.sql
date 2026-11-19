-- CreateEnum
CREATE TYPE "project_folder_state" AS ENUM ('pending', 'present', 'missing');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "folder_state" "project_folder_state",
ADD COLUMN     "name_sealed" JSONB,
ALTER COLUMN "repository_id" DROP NOT NULL,
ALTER COLUMN "github_repo_id" DROP NOT NULL,
ALTER COLUMN "owner" DROP NOT NULL,
ALTER COLUMN "name" DROP NOT NULL,
ALTER COLUMN "full_name" DROP NOT NULL,
ALTER COLUMN "display_name" DROP NOT NULL;


-- A Projet is a Dépôt GitHub followed, or a Local Projet: its name sealed, its folder on the Runner.
ALTER TABLE "projects" ADD CONSTRAINT "projects_github_or_local" CHECK ((repository_id IS NOT NULL AND display_name IS NOT NULL) OR (name_sealed IS NOT NULL AND folder_state IS NOT NULL));
