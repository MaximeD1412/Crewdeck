-- CreateEnum
CREATE TYPE "ticket_source" AS ENUM ('github', 'local');

-- CreateEnum
CREATE TYPE "ticket_state" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "ticket_state_reason" AS ENUM ('completed', 'not_planned');

-- CreateEnum
CREATE TYPE "ticket_priority" AS ENUM ('P0', 'P1', 'P2');

-- CreateEnum
CREATE TYPE "ticket_size" AS ENUM ('XS', 'S', 'M', 'L', 'XL');

-- CreateEnum
CREATE TYPE "branch_prefix" AS ENUM ('feat', 'fix', 'chore');

-- CreateEnum
CREATE TYPE "code_change_state" AS ENUM ('draft', 'open', 'merged', 'closed');

-- CreateEnum
CREATE TYPE "checks_state" AS ENUM ('none', 'pending', 'passed', 'failed');

-- CreateEnum
CREATE TYPE "merged_by" AS ENUM ('loop', 'pilot');

-- CreateEnum
CREATE TYPE "check_state" AS ENUM ('running', 'passed', 'failed');

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source" "ticket_source" NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT,
    "title_sealed" JSONB,
    "state" "ticket_state" NOT NULL,
    "state_reason" "ticket_state_reason",
    "closed_at" TIMESTAMPTZ,
    "ready_mark" BOOLEAN NOT NULL,
    "ready" BOOLEAN NOT NULL,
    "labels" TEXT[],
    "labels_sealed" JSONB,
    "priority" "ticket_priority",
    "size" "ticket_size",
    "milestone_number" INTEGER,
    "blocked_by" INTEGER[],
    "parent_number" INTEGER,
    "branch_prefix" "branch_prefix" NOT NULL,
    "visual_review" BOOLEAN NOT NULL,
    "source_created_at" TIMESTAMPTZ NOT NULL,
    "source_updated_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source" "ticket_source" NOT NULL,
    "number" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "title" TEXT,
    "title_sealed" JSONB,
    "state" "ticket_state" NOT NULL,
    "due_on" DATE,
    "open_count" INTEGER NOT NULL,
    "closed_count" INTEGER NOT NULL,
    "closed_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_changes" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source" "ticket_source" NOT NULL,
    "number" INTEGER NOT NULL,
    "ticket_number" INTEGER,
    "title" TEXT,
    "title_sealed" JSONB,
    "state" "code_change_state" NOT NULL,
    "head_ref" TEXT,
    "base_ref" TEXT NOT NULL,
    "head_sha" TEXT,
    "checks" "checks_state" NOT NULL DEFAULT 'none',
    "checks_sha" TEXT,
    "merged_at" TIMESTAMPTZ,
    "merged_by" "merged_by",
    "merge_sha" TEXT,
    "source_created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "code_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_change_checks" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "code_change_id" UUID NOT NULL,
    "sha" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" "check_state" NOT NULL,
    "duration_ms" INTEGER,
    "url" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "code_change_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tickets_pilot_id_project_id_number_idx" ON "tickets"("pilot_id", "project_id", "number");

-- CreateIndex
CREATE INDEX "tickets_pilot_id_state_closed_at_idx" ON "tickets"("pilot_id", "state", "closed_at");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_project_id_number_key" ON "tickets"("project_id", "number");

-- CreateIndex
CREATE INDEX "milestones_pilot_id_state_closed_at_idx" ON "milestones"("pilot_id", "state", "closed_at");

-- CreateIndex
CREATE UNIQUE INDEX "milestones_project_id_number_key" ON "milestones"("project_id", "number");

-- CreateIndex
CREATE INDEX "code_changes_pilot_id_project_id_ticket_number_idx" ON "code_changes"("pilot_id", "project_id", "ticket_number");

-- CreateIndex
CREATE INDEX "code_changes_pilot_id_state_updated_at_idx" ON "code_changes"("pilot_id", "state", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "code_changes_project_id_number_key" ON "code_changes"("project_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "code_changes_pilot_id_id_key" ON "code_changes"("pilot_id", "id");

-- CreateIndex
CREATE INDEX "code_change_checks_pilot_id_code_change_id_sha_idx" ON "code_change_checks"("pilot_id", "code_change_id", "sha");

-- CreateIndex
CREATE UNIQUE INDEX "code_change_checks_code_change_id_sha_name_key" ON "code_change_checks"("code_change_id", "sha", "name");

-- CreateIndex
CREATE UNIQUE INDEX "projects_pilot_id_id_key" ON "projects"("pilot_id", "id");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_pilot_id_project_id_fkey" FOREIGN KEY ("pilot_id", "project_id") REFERENCES "projects"("pilot_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_pilot_id_project_id_fkey" FOREIGN KEY ("pilot_id", "project_id") REFERENCES "projects"("pilot_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_changes" ADD CONSTRAINT "code_changes_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_changes" ADD CONSTRAINT "code_changes_pilot_id_project_id_fkey" FOREIGN KEY ("pilot_id", "project_id") REFERENCES "projects"("pilot_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_change_checks" ADD CONSTRAINT "code_change_checks_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_change_checks" ADD CONSTRAINT "code_change_checks_pilot_id_code_change_id_fkey" FOREIGN KEY ("pilot_id", "code_change_id") REFERENCES "code_changes"("pilot_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A GitHub row has a readable title and no sealed one, a Local row the reverse (ADR 0012).
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_title_by_source" CHECK (
  ("source" = 'github' AND "title" IS NOT NULL AND "title_sealed" IS NULL AND "labels_sealed" IS NULL)
  OR ("source" = 'local' AND "title" IS NULL AND "title_sealed" IS NOT NULL)
);
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_title_by_source" CHECK (
  ("source" = 'github' AND "title" IS NOT NULL AND "title_sealed" IS NULL)
  OR ("source" = 'local' AND "title" IS NULL AND "title_sealed" IS NOT NULL)
);
ALTER TABLE "code_changes" ADD CONSTRAINT "code_changes_title_by_source" CHECK (
  ("source" = 'github' AND "title" IS NOT NULL AND "title_sealed" IS NULL)
  OR ("source" = 'local' AND "title" IS NULL AND "title_sealed" IS NOT NULL)
);
