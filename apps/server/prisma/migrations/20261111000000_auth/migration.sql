-- AlterTable
ALTER TABLE "pilots" ADD COLUMN     "avatar_url" TEXT;

-- CreateTable
CREATE TABLE "github_user_tokens" (
    "pilot_id" UUID NOT NULL,
    "access_token_enc" BYTEA NOT NULL,
    "access_expires_at" TIMESTAMPTZ NOT NULL,
    "refresh_token_enc" BYTEA NOT NULL,
    "refresh_expires_at" TIMESTAMPTZ NOT NULL,
    "key_version" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "github_user_tokens_pkey" PRIMARY KEY ("pilot_id")
);

-- CreateTable
CREATE TABLE "web_sessions" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "user_agent" TEXT,

    CONSTRAINT "web_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "web_sessions_token_hash_key" ON "web_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "web_sessions_pilot_id_idx" ON "web_sessions"("pilot_id");

-- AddForeignKey
ALTER TABLE "github_user_tokens" ADD CONSTRAINT "github_user_tokens_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_sessions" ADD CONSTRAINT "web_sessions_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
