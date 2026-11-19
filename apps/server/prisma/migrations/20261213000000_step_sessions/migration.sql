-- AlterTable
ALTER TABLE "agent_sessions" ADD COLUMN     "step_skill" TEXT,
ADD COLUMN     "step_contract_id" TEXT,
ADD COLUMN     "step_inputs" JSONB,
ADD COLUMN     "mcp_servers" JSONB NOT NULL DEFAULT '[]';
