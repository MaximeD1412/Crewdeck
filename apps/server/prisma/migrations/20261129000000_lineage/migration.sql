-- Lineage (PROCESS-5): the PhaseRun whose output became the item, and the
-- Idée without a Projet, run on a definition of the release.

-- AlterTable
ALTER TABLE "phase_runs" ADD COLUMN "builtin_template" TEXT,
ADD COLUMN "parent_phase_run_id" UUID,
ALTER COLUMN "project_id" DROP NOT NULL,
ALTER COLUMN "process_version_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "step_runs" ALTER COLUMN "project_id" DROP NOT NULL;

-- A PhaseRun has a Projet and its version, or neither and a builtin definition.
ALTER TABLE "phase_runs" ADD CONSTRAINT "phase_runs_project_or_builtin" CHECK ((project_id IS NULL) = (builtin_template IS NOT NULL));
ALTER TABLE "phase_runs" ADD CONSTRAINT "phase_runs_version_or_builtin" CHECK ((process_version_id IS NULL) = (builtin_template IS NOT NULL));

-- Each Entrée says whether it is « absente »: none had one so far but those that got no Artefact.
UPDATE "step_runs" SET "inputs" = (
  SELECT coalesce(jsonb_agg(input || jsonb_build_object('absent', jsonb_array_length(input -> 'artifacts') = 0)), '[]'::jsonb)
  FROM jsonb_array_elements("inputs") AS input
);

-- CreateIndex
CREATE UNIQUE INDEX "phase_runs_builtin_phase_id_item_unfinished_key" ON "phase_runs"("pilot_id", "builtin_template", "phase_id", "item_type", "item_id") WHERE (state IN ('running', 'waiting') AND project_id IS NULL);

-- CreateIndex
CREATE INDEX "phase_runs_pilot_id_parent_phase_run_id_idx" ON "phase_runs"("pilot_id", "parent_phase_run_id");

-- AddForeignKey: only the parent's id is set to null when it is deleted, never the Pilote's.
ALTER TABLE "phase_runs" ADD CONSTRAINT "phase_runs_pilot_id_parent_phase_run_id_fkey" FOREIGN KEY ("pilot_id", "parent_phase_run_id") REFERENCES "phase_runs"("pilot_id", "id") ON DELETE SET NULL ("parent_phase_run_id") ON UPDATE CASCADE;
