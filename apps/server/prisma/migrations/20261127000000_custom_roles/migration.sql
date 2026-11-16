-- The Rôles a Pilote adds (PARAM-2), beside the four default ones.
-- CreateTable
CREATE TABLE "custom_roles" (
    "id" TEXT NOT NULL,
    "pilot_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "engine" "engine_id" NOT NULL,
    "model" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custom_roles_pilot_id_name_key_key" ON "custom_roles"("pilot_id", "name_key");

-- AddForeignKey
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

