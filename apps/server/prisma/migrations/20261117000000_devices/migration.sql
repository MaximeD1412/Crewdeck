-- CreateEnum
CREATE TYPE "device_state" AS ENUM ('pending', 'trusted', 'revoked');

-- CreateEnum
CREATE TYPE "vault_key_holder_type" AS ENUM ('device', 'runner');

-- AlterEnum
ALTER TYPE "runner_link_failure" ADD VALUE 'pairing-mismatch';
ALTER TYPE "runner_link_failure" ADD VALUE 'device-not-trusted';

-- AlterTable
ALTER TABLE "pilots" ADD COLUMN     "vault_key_version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "runner_link_codes" ADD COLUMN     "device_id" UUID;

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "public_key" BYTEA NOT NULL,
    "state" "device_state" NOT NULL DEFAULT 'pending',
    "approved_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "last_seen_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_key_wraps" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "holder_type" "vault_key_holder_type" NOT NULL,
    "holder_id" UUID NOT NULL,
    "vault_key_version" INTEGER NOT NULL,
    "enc" BYTEA NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "tag" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_key_wraps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "devices_pilot_id_created_at_idx" ON "devices"("pilot_id", "created_at");

-- CreateIndex
CREATE INDEX "vault_key_wraps_pilot_id_holder_id_idx" ON "vault_key_wraps"("pilot_id", "holder_id");

-- CreateIndex
CREATE UNIQUE INDEX "vault_key_wraps_holder_type_holder_id_vault_key_version_key" ON "vault_key_wraps"("holder_type", "holder_id", "vault_key_version");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_key_wraps" ADD CONSTRAINT "vault_key_wraps_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

