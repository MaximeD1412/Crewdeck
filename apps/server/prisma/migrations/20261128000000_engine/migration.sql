-- CreateEnum
CREATE TYPE "phase_run_state" AS ENUM ('running', 'waiting', 'done', 'stopped', 'failed');

-- CreateEnum
CREATE TYPE "step_run_state" AS ENUM ('running', 'waiting', 'interrupted', 'blocked', 'done', 'failed', 'stopped', 'superseded');

-- CreateEnum
CREATE TYPE "step_verdict" AS ENUM ('passed', 'changes', 'failed');

-- CreateTable
CREATE TABLE "phase_runs" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "process_version_id" UUID NOT NULL,
    "phase_id" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "state" "phase_run_state" NOT NULL,
    "waiting_on" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ,
    "last_seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "phase_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_runs" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "phase_run_id" UUID NOT NULL,
    "step_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "iteration" INTEGER NOT NULL DEFAULT 1,
    "state" "step_run_state" NOT NULL,
    "inputs" JSONB NOT NULL,
    "outputs" JSONB NOT NULL DEFAULT '[]',
    "verdict" "step_verdict",
    "failure" TEXT,
    "reason" TEXT,
    "session_id" UUID,
    "contrat_verdict" JSONB,
    "started_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ,
    "last_seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "step_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "phase_runs_pilot_id_project_id_state_idx" ON "phase_runs"("pilot_id", "project_id", "state");

-- CreateIndex
CREATE INDEX "phase_runs_pilot_id_item_type_item_id_idx" ON "phase_runs"("pilot_id", "item_type", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "phase_runs_pilot_id_id_key" ON "phase_runs"("pilot_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "phase_runs_project_id_phase_id_item_unfinished_key" ON "phase_runs"("project_id", "phase_id", "item_type", "item_id") WHERE (state IN ('running', 'waiting'));

-- CreateIndex
CREATE INDEX "step_runs_pilot_id_phase_run_id_idx" ON "step_runs"("pilot_id", "phase_run_id");

-- CreateIndex
CREATE INDEX "step_runs_outputs_idx" ON "step_runs" USING GIN ("outputs" jsonb_path_ops);

-- CreateIndex
CREATE UNIQUE INDEX "process_versions_pilot_id_id_key" ON "process_versions"("pilot_id", "id");

-- AddForeignKey
ALTER TABLE "phase_runs" ADD CONSTRAINT "phase_runs_pilot_id_project_id_fkey" FOREIGN KEY ("pilot_id", "project_id") REFERENCES "projects"("pilot_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phase_runs" ADD CONSTRAINT "phase_runs_pilot_id_process_version_id_fkey" FOREIGN KEY ("pilot_id", "process_version_id") REFERENCES "process_versions"("pilot_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_runs" ADD CONSTRAINT "step_runs_pilot_id_project_id_fkey" FOREIGN KEY ("pilot_id", "project_id") REFERENCES "projects"("pilot_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_runs" ADD CONSTRAINT "step_runs_pilot_id_phase_run_id_fkey" FOREIGN KEY ("pilot_id", "phase_run_id") REFERENCES "phase_runs"("pilot_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

