-- PROJET-4: of a Projet's Inventaire, the commit its Contrat checked and the
-- counts its Session reported; never its text.
ALTER TABLE "projects" ADD COLUMN     "inventory_head_sha" TEXT,
ADD COLUMN     "inventory_figures" JSONB;

-- A Projet's PhaseRun may run on the builtin « Préparation » (its Inventaire,
-- before its Process); only an Idée without a Projet runs on « Process Crewdeck ».
ALTER TABLE "phase_runs" DROP CONSTRAINT "phase_runs_project_or_builtin";
ALTER TABLE "phase_runs" ADD CONSTRAINT "phase_runs_project_or_builtin" CHECK ((project_id IS NULL) = (builtin_template IS NOT DISTINCT FROM 'process-crewdeck'));
