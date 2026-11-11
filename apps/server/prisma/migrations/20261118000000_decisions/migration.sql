-- CreateEnum
CREATE TYPE "decision_state" AS ENUM ('open', 'resolved');

-- CreateEnum
CREATE TYPE "decision_tone" AS ENUM ('accent', 'caution', 'halt');

-- CreateTable
CREATE TABLE "decisions" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "project_id" UUID,
    "project_name" TEXT,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "meta_parts" TEXT[],
    "tone" "decision_tone" NOT NULL,
    "link" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "state" "decision_state" NOT NULL DEFAULT 'open',
    "outcome" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "decisions_pilot_id_state_created_at_idx" ON "decisions"("pilot_id", "state", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "decisions_pilot_id_kind_subject_id_open_key" ON "decisions"("pilot_id", "kind", "subject_id") WHERE (state = 'open');

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

