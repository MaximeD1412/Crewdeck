-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "approval_proof" BYTEA,
ADD COLUMN     "approver_id" UUID,
ADD COLUMN     "approver_public_key" BYTEA,
ADD COLUMN     "approver_type" "vault_key_holder_type",
ADD COLUMN     "expires_at" TIMESTAMPTZ,
ADD COLUMN     "proof" BYTEA,
ADD COLUMN     "short_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "devices_pilot_id_short_id_pending_key" ON "devices"("pilot_id", "short_id") WHERE (state = 'pending' AND short_id IS NOT NULL);

