import type { ArtifactRef } from '@crewdeck/contracts';
import type { AgentKindSpec } from '../../process/engine/kinds/agent.js';
import type { Tx } from '../../realtime/transactions.js';

/** The branch every Inventaire is drafted on, in the repository or the Local folder. */
export const INVENTORY_BRANCH = 'crewdeck/inventaire';

/** The Phase of « Préparation » the Inventaire runs in. */
export const INVENTORY_PHASE = 'ph-preparation';

/** A head the Runner's verdict names, kept only when it is a commit's SHA. */
const SHA = /^[0-9a-f]{40}$/;

export const inventoryHeadOf = (headSha: string | undefined): string | null => (headSha !== undefined && SHA.test(headSha) ? headSha : null);

const projectOf = (run: { phaseRun: { projectId: string | null } }): string => {
  if (run.phaseRun.projectId === null) throw new Error('An Inventaire runs for a Projet.');
  return run.phaseRun.projectId;
};

/**
 * The Étape « Inventaire » (PROJET-4): its Session titled « Inventaire » on
 * `crewdeck/inventaire`, from the Projet's release branch (its code is
 * there; the integration branch may not exist yet), and once its Contrat
 * passed, the Projet's Inventaire at the commit the verdict names.
 */
export const INVENTORY_KIND: AgentKindSpec = {
  kind: 'inventory',
  title: () => 'Inventaire',
  branch: () => INVENTORY_BRANCH,
  base: async (tx: Tx, run) => (await tx.project.findUniqueOrThrow({ where: { id: projectOf(run) }, select: { releaseBranch: true } })).releaseBranch,
  outputs: (_tx, run): ArtifactRef[] => {
    const sha = inventoryHeadOf(run.stepRun.contratVerdict?.headSha);
    return [{ portId: 'inventaire', type: 'inventory', id: projectOf(run), ...(sha === null ? {} : { sha }) }];
  },
};
