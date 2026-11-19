-- SOURCE-7: the migrations of a group of Source, one running per Projet (ADR 0012).
-- CreateEnum
CREATE TYPE "source_migration_state" AS ENUM ('draining', 'copying', 'verifying', 'switched', 'done', 'failed');

-- CreateTable
CREATE TABLE "source_migrations" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "group" "source_group" NOT NULL,
    "from" "source_kind" NOT NULL,
    "to" "source_kind" NOT NULL,
    "state" "source_migration_state" NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "copied" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "fingerprints" JSONB NOT NULL DEFAULT '[]',
    "waiting_items" JSONB NOT NULL DEFAULT '[]',
    "error_code" TEXT,
    "finish_tries" INTEGER NOT NULL DEFAULT 0,
    "next_finish_at" TIMESTAMPTZ,
    "last_seq" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL,
    "switched_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,

    CONSTRAINT "source_migrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "source_migrations_pilot_id_project_id_created_at_idx" ON "source_migrations"("pilot_id", "project_id", "created_at");

-- CreateIndex
CREATE INDEX "source_migrations_state_next_finish_at_idx" ON "source_migrations"("state", "next_finish_at");

-- CreateIndex
CREATE UNIQUE INDEX "source_migrations_project_id_running_key" ON "source_migrations"("project_id") WHERE (state IN ('draining', 'copying', 'verifying', 'switched'));

-- AddForeignKey
ALTER TABLE "source_migrations" ADD CONSTRAINT "source_migrations_pilot_id_project_id_fkey" FOREIGN KEY ("pilot_id", "project_id") REFERENCES "projects"("pilot_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

