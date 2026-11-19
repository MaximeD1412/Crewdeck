-- The seq of the last process.upserted written while the draft exists (PROCESS-10): what process.activate's freshness check compares.
-- AlterTable
ALTER TABLE "process_drafts" ADD COLUMN "last_seq" BIGINT NOT NULL DEFAULT 0;
