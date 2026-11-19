-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "readiness" JSONB,
ADD COLUMN     "readiness_facts" JSONB;
