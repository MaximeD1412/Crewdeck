-- CreateTable
CREATE TABLE "github_deliveries" (
    "delivery_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_deliveries_pkey" PRIMARY KEY ("delivery_id")
);

-- CreateTable
CREATE TABLE "github_installations" (
    "installation_id" BIGINT NOT NULL,
    "account_login" TEXT NOT NULL,
    "account_id" BIGINT NOT NULL,
    "sender_id" BIGINT NOT NULL,
    "pilot_id" UUID,
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_installations_pkey" PRIMARY KEY ("installation_id")
);

-- CreateIndex
CREATE INDEX "github_deliveries_received_at_idx" ON "github_deliveries"("received_at");

-- CreateIndex
CREATE INDEX "github_installations_pilot_id_idx" ON "github_installations"("pilot_id");

-- CreateIndex
CREATE INDEX "github_installations_sender_id_idx" ON "github_installations"("sender_id");

-- AddForeignKey
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

