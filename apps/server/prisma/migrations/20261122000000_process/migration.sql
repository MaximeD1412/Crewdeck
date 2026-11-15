-- CreateEnum
CREATE TYPE "process_activation" AS ENUM ('creation', 'pilot');

-- CreateTable
CREATE TABLE "process_versions" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "sealed" JSONB,
    "activated_at" TIMESTAMPTZ NOT NULL,
    "activated_by" "process_activation" NOT NULL,
    "template_name" TEXT,

    CONSTRAINT "process_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_drafts" (
    "id" UUID NOT NULL,
    "pilot_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "definition" JSONB NOT NULL,
    "sealed" JSONB,
    "revision" INTEGER NOT NULL,
    "base_version" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "process_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "process_versions_pilot_id_project_id_idx" ON "process_versions"("pilot_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "process_versions_project_id_number_key" ON "process_versions"("project_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "process_drafts_project_id_key" ON "process_drafts"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "process_drafts_pilot_id_project_id_key" ON "process_drafts"("pilot_id", "project_id");

-- AddForeignKey
ALTER TABLE "process_versions" ADD CONSTRAINT "process_versions_pilot_id_project_id_fkey" FOREIGN KEY ("pilot_id", "project_id") REFERENCES "projects"("pilot_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_drafts" ADD CONSTRAINT "process_drafts_pilot_id_project_id_fkey" FOREIGN KEY ("pilot_id", "project_id") REFERENCES "projects"("pilot_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A version is immutable once written (ADR 0011): no UPDATE of a row, ever.
CREATE FUNCTION "process_versions_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'process_versions rows are immutable: write the next version instead (ADR 0011)';
END;
$$;

CREATE TRIGGER "process_versions_no_update" BEFORE UPDATE ON "process_versions"
  FOR EACH ROW EXECUTE FUNCTION "process_versions_immutable"();
