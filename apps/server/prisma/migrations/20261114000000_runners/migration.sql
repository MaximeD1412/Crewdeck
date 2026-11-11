-- CreateEnum
CREATE TYPE "runner_state" AS ENUM ('online', 'offline');

-- CreateEnum
CREATE TYPE "runner_os" AS ENUM ('linux', 'darwin');

-- CreateEnum
CREATE TYPE "runner_arch" AS ENUM ('amd64', 'arm64');

-- CreateTable
CREATE TABLE "runners" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "machine" TEXT NOT NULL,
    "os" "runner_os" NOT NULL,
    "arch" "runner_arch" NOT NULL,
    "wsl" BOOLEAN NOT NULL,
    "runner_version" TEXT NOT NULL,
    "protocol_version" INTEGER NOT NULL,
    "state" "runner_state" NOT NULL DEFAULT 'offline',
    "last_seen_at" TIMESTAMPTZ NOT NULL,
    "linked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "runners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "runners_token_hash_key" ON "runners"("token_hash");

-- CreateIndex
CREATE INDEX "runners_pilot_id_idx" ON "runners"("pilot_id");

-- CreateIndex
CREATE INDEX "runners_state_last_seen_at_idx" ON "runners"("state", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "runners_pilot_id_current_key" ON "runners"("pilot_id") WHERE (revoked_at IS NULL);

-- AddForeignKey
ALTER TABLE "runners" ADD CONSTRAINT "runners_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

