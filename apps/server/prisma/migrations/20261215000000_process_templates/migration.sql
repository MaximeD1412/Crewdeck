-- The Modèles de process of a Pilote (PROCESS-14): a copy of a Projet's active version, its name unique per Pilote regardless of case.
-- CreateTable
CREATE TABLE "process_templates" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "from_project_id" UUID,
    "from_version_number" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "sealed" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "process_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "process_templates_pilot_id_name_key_key" ON "process_templates"("pilot_id", "name_key");

-- CreateIndex
CREATE INDEX "process_templates_pilot_id_from_project_id_idx" ON "process_templates"("pilot_id", "from_project_id");

-- AddForeignKey
ALTER TABLE "process_templates" ADD CONSTRAINT "process_templates_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: only the Projet's id is set to null when it is deleted, never the Pilote's.
ALTER TABLE "process_templates" ADD CONSTRAINT "process_templates_pilot_id_from_project_id_fkey" FOREIGN KEY ("pilot_id", "from_project_id") REFERENCES "projects"("pilot_id", "id") ON DELETE SET NULL ("from_project_id") ON UPDATE CASCADE;
