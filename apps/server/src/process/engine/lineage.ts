import type { ArtifactType, PhaseRun } from '@crewdeck/contracts';
import type { Tx } from '../../realtime/transactions.js';
import { STEP_RUN_VIEW, toStepRun } from './engine.view.js';
import type { Ancestor } from './feeding.js';

/**
 * Lineage (ADR 0011, « The engine »): each PhaseRun records the PhaseRun
 * whose output became its item, so that an Entrée fed from another Phase
 * reads what its own ancestors gave (the Revue visuelle of a Ticket, the
 * Maquettes its Conception approved).
 */

/** How far up `ancestors` climbs: deeper than any Process of 20 Phases, a stop should a chain ever loop. */
const MAX_DEPTH = 50;

/**
 * The PhaseRun whose output became `item`: that of the latest `done`
 * StepRun whose outputs hold the item's `{ type, id }`, among the Pilote's
 * StepRuns of the Projet or of no Projet (an Idée noted without one); `null`
 * when none (a Ticket written by hand). Found by the item, not by the
 * arrows: the producer may have run on another version, the item's id is
 * what both share.
 */
export const findParent = async (tx: Tx, projectId: string | null, item: { readonly type: ArtifactType; readonly id: string }): Promise<string | null> => {
  const producer = await tx.stepRun.findFirst({
    where: {
      state: 'done',
      ...(projectId === null ? { projectId: null } : { OR: [{ projectId }, { projectId: null }] }),
      outputs: { array_contains: [{ type: item.type, id: item.id }] },
    },
    select: { phaseRunId: true },
    orderBy: [{ endedAt: 'desc' }, { id: 'desc' }],
  });
  return producer?.phaseRunId ?? null;
};

/** The PhaseRun's parent, the parent's parent…, nearest first, each with its StepRuns in the order they were created. */
export const ancestors = async (tx: Tx, phaseRun: Pick<PhaseRun, 'id' | 'parentPhaseRunId'>): Promise<Ancestor[]> => {
  const chain: string[] = [];
  const seen = new Set([phaseRun.id]);
  for (let parent = phaseRun.parentPhaseRunId; parent !== null && !seen.has(parent) && chain.length < MAX_DEPTH; ) {
    chain.push(parent);
    seen.add(parent);
    const row = await tx.phaseRun.findUnique({ where: { id: parent }, select: { parentPhaseRunId: true } });
    parent = row?.parentPhaseRunId ?? null;
  }
  if (chain.length === 0) return [];
  const stepRuns = (await tx.stepRun.findMany({ where: { phaseRunId: { in: chain } }, select: STEP_RUN_VIEW, orderBy: { id: 'asc' } })).map(toStepRun);
  return chain.map((id) => ({ id, stepRuns: stepRuns.filter((run) => run.phaseRunId === id) }));
};
