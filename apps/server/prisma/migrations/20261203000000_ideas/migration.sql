-- CreateEnum
CREATE TYPE "idea_state" AS ENUM ('analysing', 'to-triage', 'analysed', 'retained', 'merged', 'rejected');

-- CreateEnum
CREATE TYPE "idea_noted_from" AS ENUM ('pc', 'telephone');

-- AlterTable
ALTER TABLE "pilots" ADD COLUMN     "idea_seq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ideas" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "project_id" UUID,
    "target_project_id" UUID,
    "target_is_new" BOOLEAN NOT NULL DEFAULT false,
    "state" "idea_state" NOT NULL,
    "text" JSONB NOT NULL,
    "analysis" JSONB,
    "impact" INTEGER,
    "effort" INTEGER,
    "duplicate_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "noted_from" "idea_noted_from" NOT NULL,
    "dictated" BOOLEAN NOT NULL DEFAULT false,
    "merged_into_id" UUID,
    "reason" JSONB,
    "ticket_number" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "analysed_at" TIMESTAMPTZ,
    "triaged_at" TIMESTAMPTZ,
    "last_seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "ideas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ideas_pilot_id_state_updated_at_idx" ON "ideas"("pilot_id", "state", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "ideas_pilot_id_number_key" ON "ideas"("pilot_id", "number");

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_pilot_id_project_id_fkey" FOREIGN KEY ("pilot_id", "project_id") REFERENCES "projects"("pilot_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_pilot_id_target_project_id_fkey" FOREIGN KEY ("pilot_id", "target_project_id") REFERENCES "projects"("pilot_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

