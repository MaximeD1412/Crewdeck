-- CreateEnum
CREATE TYPE "inventory_state" AS ENUM ('not-needed', 'pending', 'drafting', 'to-approve', 'awaiting-merge', 'approved');

-- CreateTable
CREATE TABLE "repositories" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "installation_id" BIGINT NOT NULL,
    "github_id" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "private" BOOLEAN NOT NULL,
    "default_branch" TEXT NOT NULL,
    "has_code" BOOLEAN NOT NULL,
    "last_seq" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "github_repo_id" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "release_branch" TEXT NOT NULL,
    "integration_branch" TEXT NOT NULL,
    "has_code" BOOLEAN NOT NULL,
    "inventory_state" "inventory_state" NOT NULL,
    "access_lost" BOOLEAN NOT NULL DEFAULT false,
    "last_seq" BIGINT NOT NULL DEFAULT 0,
    "followed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "repositories_pilot_id_name_idx" ON "repositories"("pilot_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_pilot_id_github_id_key" ON "repositories"("pilot_id", "github_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_repository_id_key" ON "projects"("repository_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_pilot_id_github_repo_id_key" ON "projects"("pilot_id", "github_repo_id");

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

