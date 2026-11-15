-- CreateEnum
CREATE TYPE "github_change_kind" AS ENUM ('issue', 'pull', 'push', 'check', 'release', 'label', 'milestone');

-- AlterTable
ALTER TABLE "pilots" ADD COLUMN "github_change_seq" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "github_changes" (
    "pilot_id" UUID NOT NULL,
    "seq" BIGINT NOT NULL,
    "project_id" UUID NOT NULL,
    "repository" TEXT NOT NULL,
    "kind" "github_change_kind" NOT NULL,
    "number" INTEGER,
    "sha" TEXT,
    "ref" TEXT,
    "action" TEXT,
    "at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "github_changes_pkey" PRIMARY KEY ("pilot_id","seq")
);

-- CreateIndex
CREATE INDEX "github_changes_at_idx" ON "github_changes"("at");

-- AddForeignKey
ALTER TABLE "github_changes" ADD CONSTRAINT "github_changes_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
