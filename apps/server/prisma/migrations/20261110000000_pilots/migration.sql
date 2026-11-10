-- CreateTable
CREATE TABLE "pilots" (
    "id" UUID NOT NULL,
    "github_user_id" BIGINT NOT NULL,
    "login" TEXT NOT NULL,
    "time_zone" TEXT NOT NULL,
    "seq" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pilots_github_user_id_key" ON "pilots"("github_user_id");

