-- AlterTable
ALTER TABLE "agent_sessions" ADD COLUMN     "title_sealed" JSONB,
ADD COLUMN     "title_aad" TEXT,
ALTER COLUMN "title" DROP NOT NULL;

-- A Session's title is readable (an artifact's on GitHub) or sealed (a Local one's), never both nor none (SOURCE-2).
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_title_readable_or_sealed" CHECK ((title IS NOT NULL) <> (title_sealed IS NOT NULL));

-- A sealed title keeps the additional data its artifact sealed it under, which the page opens it with and a rotation rewraps it with.
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_title_sealed_with_its_aad" CHECK ((title_sealed IS NULL) = (title_aad IS NULL));
