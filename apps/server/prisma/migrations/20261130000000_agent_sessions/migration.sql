-- CreateEnum
CREATE TYPE "agent_session_state" AS ENUM ('starting', 'active', 'waiting', 'stopped', 'interrupted', 'ended');

-- CreateEnum
CREATE TYPE "agent_session_outcome" AS ENUM ('ok', 'error');

-- CreateEnum
CREATE TYPE "agent_session_error" AS ENUM ('setup-failed', 'branch-busy', 'engine-failed', 'clone-failed');

-- CreateEnum
CREATE TYPE "agent_session_interrupted_reason" AS ENUM ('runner-offline', 'runner-restarted');

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "engine" "engine_id" NOT NULL,
    "model" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "permission_mode" TEXT NOT NULL,
    "state" "agent_session_state" NOT NULL,
    "interrupted_reason" "agent_session_interrupted_reason",
    "outcome" "agent_session_outcome",
    "error" "agent_session_error",
    "step_run_id" UUID,
    "step_kind" TEXT,
    "engine_session_id" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ,
    "last_seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_sessions_pilot_id_project_id_started_at_idx" ON "agent_sessions"("pilot_id", "project_id", "started_at");

-- CreateIndex
CREATE INDEX "agent_sessions_pilot_id_state_idx" ON "agent_sessions"("pilot_id", "state");

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_pilot_id_project_id_fkey" FOREIGN KEY ("pilot_id", "project_id") REFERENCES "projects"("pilot_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

