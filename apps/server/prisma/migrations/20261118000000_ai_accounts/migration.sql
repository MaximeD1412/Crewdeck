-- CreateEnum
CREATE TYPE "engine_id" AS ENUM ('claude-code', 'codex');

-- CreateEnum
CREATE TYPE "ai_account_kind" AS ENUM ('subscription', 'api-key', 'none');

-- CreateEnum
CREATE TYPE "ai_account_state" AS ENUM ('connected', 'login-required');

-- CreateTable
CREATE TABLE "ai_accounts" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "engine" "engine_id" NOT NULL,
    "installed" BOOLEAN NOT NULL,
    "version" TEXT,
    "known_version" BOOLEAN NOT NULL,
    "kind" "ai_account_kind" NOT NULL,
    "state" "ai_account_state" NOT NULL,
    "models" JSONB NOT NULL,
    "reported_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ai_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_accounts_pilot_id_engine_key" ON "ai_accounts"("pilot_id", "engine");

-- AddForeignKey
ALTER TABLE "ai_accounts" ADD CONSTRAINT "ai_accounts_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

