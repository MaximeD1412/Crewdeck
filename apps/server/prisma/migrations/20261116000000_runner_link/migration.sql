-- CreateEnum
CREATE TYPE "getting_started_step" AS ENUM ('runner', 'ai-accounts', 'projects', 'done');

-- CreateEnum
CREATE TYPE "runner_link_state" AS ENUM ('waiting', 'pending', 'linked', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "runner_link_failure" AS ENUM ('expired', 'already-used', 'unsupported-system', 'no-engine');

-- AlterTable
ALTER TABLE "pilots" ADD COLUMN     "getting_started_step" "getting_started_step" NOT NULL DEFAULT 'runner',
ADD COLUMN     "last_seq" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "runner_link_codes" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "short_id" TEXT NOT NULL,
    "state" "runner_link_state" NOT NULL DEFAULT 'waiting',
    "failure_reason" "runner_link_failure",
    "browser_pairing" JSONB NOT NULL,
    "runner_pairing" JSONB,
    "confirm_pairing" JSONB,
    "pending_runner" JSONB,
    "runner_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "runner_link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "runner_link_codes_pilot_id_created_at_idx" ON "runner_link_codes"("pilot_id", "created_at");

-- CreateIndex
CREATE INDEX "runner_link_codes_short_id_idx" ON "runner_link_codes"("short_id");

-- CreateIndex
CREATE INDEX "runner_link_codes_state_expires_at_idx" ON "runner_link_codes"("state", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "runner_link_codes_short_id_live_key" ON "runner_link_codes"("short_id") WHERE (state IN ('waiting', 'pending'));

-- AddForeignKey
ALTER TABLE "runner_link_codes" ADD CONSTRAINT "runner_link_codes_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

