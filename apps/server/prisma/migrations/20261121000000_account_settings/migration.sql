-- The Paramètres of the account (PARAM-1): one row per Pilote once they change one.
-- CreateTable
CREATE TABLE "account_settings" (
    "pilot_id" UUID NOT NULL,
    "roles" JSONB NOT NULL,
    "optional_steps" JSONB NOT NULL,
    "notifications_push" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "account_settings_pkey" PRIMARY KEY ("pilot_id")
);

-- AddForeignKey
ALTER TABLE "account_settings" ADD CONSTRAINT "account_settings_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

