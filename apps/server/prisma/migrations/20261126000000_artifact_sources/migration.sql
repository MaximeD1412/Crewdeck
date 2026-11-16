-- The Sources of a Projet (SOURCE-1, ADR 0012): one row per group, both written at its creation.
-- CreateEnum
CREATE TYPE "source_group" AS ENUM ('ticket', 'code');

-- CreateEnum
CREATE TYPE "source_kind" AS ENUM ('local', 'github');

-- CreateTable
CREATE TABLE "artifact_sources" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "group" "source_group" NOT NULL,
    "source" "source_kind" NOT NULL,
    "since" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "artifact_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "artifact_sources_pilot_id_project_id_idx" ON "artifact_sources"("pilot_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_sources_project_id_group_key" ON "artifact_sources"("project_id", "group");

-- AddForeignKey
ALTER TABLE "artifact_sources" ADD CONSTRAINT "artifact_sources_pilot_id_project_id_fkey" FOREIGN KEY ("pilot_id", "project_id") REFERENCES "projects"("pilot_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every Projet followed before is a Dépôt GitHub, both its groups on GitHub since it was followed.
INSERT INTO "artifact_sources" ("id", "pilot_id", "project_id", "group", "source", "since")
SELECT gen_random_uuid(), "projects"."pilot_id", "projects"."id", "groups"."group", 'github', "projects"."followed_at"
FROM "projects" CROSS JOIN (VALUES ('ticket'::"source_group"), ('code'::"source_group")) AS "groups"("group");
