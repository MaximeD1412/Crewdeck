-- Retours (PROCESS-6): what each PhaseRun took of its Phase's Retours,
-- `{ from, to, taken, extra }`, none so far.

-- AlterTable
ALTER TABLE "phase_runs" ADD COLUMN "loop_backs" JSONB NOT NULL DEFAULT '[]';
