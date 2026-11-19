-- No Étapes optionnelles any more (PARAM-3): an Étape runs because it is in the Projet's Process; dropped, not migrated.
-- AlterTable
ALTER TABLE "account_settings" DROP COLUMN "optional_steps";

-- What a Projet changed over its Pilote's account (PARAM-3): one row per Projet once it changes one.
-- CreateTable
CREATE TABLE "project_settings" (
    "project_id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "roles" JSONB NOT NULL,
    "notifications_push" BOOLEAN,
    "worktree_commands" JSONB,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "project_settings_pkey" PRIMARY KEY ("project_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_settings_pilot_id_project_id_key" ON "project_settings"("pilot_id", "project_id");

-- AddForeignKey
ALTER TABLE "project_settings" ADD CONSTRAINT "project_settings_pilot_id_project_id_fkey" FOREIGN KEY ("pilot_id", "project_id") REFERENCES "projects"("pilot_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
