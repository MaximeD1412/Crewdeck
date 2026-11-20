-- AlterTable
ALTER TABLE "ideas" ADD COLUMN     "analysis_pending" JSONB,
ADD COLUMN     "analysis_run" JSONB;

-- AlterTable
ALTER TABLE "agent_sessions" ADD COLUMN     "step_ideas" JSONB,
ALTER COLUMN "project_id" DROP NOT NULL,
ALTER COLUMN "branch" DROP NOT NULL,
ALTER COLUMN "base" DROP NOT NULL;

