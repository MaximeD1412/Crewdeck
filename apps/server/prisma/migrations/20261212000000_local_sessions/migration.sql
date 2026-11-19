-- AlterTable
ALTER TABLE "agent_sessions" ADD COLUMN     "title_sealed" JSONB,
ALTER COLUMN "title" DROP NOT NULL;

-- A Session's title is readable (a GitHub Projet's) or sealed (a Local one's), never both nor none (SOURCE-2).
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_title_readable_or_sealed" CHECK ((title IS NOT NULL) <> (title_sealed IS NOT NULL));
