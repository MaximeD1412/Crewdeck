import { z } from 'zod';
import { zRoleId } from '../api/roles.js';
import { type ArtifactType, zArtifactType } from './artifact-types.js';
import { zStepKind } from './catalogue.js';

/**
 * A Projet's Process as one document (ADR 0011): Phases holding Étapes whose
 * typed Entrées and Sorties are joined by arrows, Retours with a maximum,
 * Outils on each Étape, the Commandes' ids. A version is one immutable
 * definition, stored and sent whole; the Commandes' text is in its sealed
 * part. What this schema cannot say (unique ids, an arrow's ends, no cycle)
 * is `validateDefinition`'s.
 */

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * An id inside a definition (`ph-dev`, `st-code`, a port's `changement`, a
 * Commande's): chosen by the page, unique in the definition (Phases and
 * Étapes share one namespace, a port's is unique in its Étape), stable
 * across versions.
 */
export const zProcessId = z.string().min(1).max(40).regex(ID);
export type ProcessId = z.infer<typeof zProcessId>;

const zName = z.string().trim().min(1).max(60);
/** A cell of the grid: a Phase's in the canvas, an Étape's in its Phase. */
const zCell = z.int().min(1).max(50);

/** What a « pour chaque » Phase repeats for: a closed list at the MVP. */
export const FOR_EACH = {
  'idea.noted': { type: 'idea', label: 'chaque Idée notée' },
  'idea.retained': { type: 'idea', label: 'chaque Idée retenue' },
  'ticket.ready': { type: 'ticket', label: 'chaque Ticket prêt' },
} as const satisfies Record<string, { type: ArtifactType; label: string }>;
export type ForEach = keyof typeof FOR_EACH;
export const zForEach = z.enum(Object.keys(FOR_EACH) as [ForEach, ...ForEach[]]);

export const zPhase = z.strictObject({ id: zProcessId, name: zName, col: zCell, row: zCell, forEach: zForEach.nullable() });
export type Phase = z.infer<typeof zPhase>;

/** An Entrée or a Sortie: its id in the Étape, its type, and a note the canvas shows beside it (« retenue »). */
export const zPort = z.strictObject({ id: zProcessId, type: zArtifactType, note: z.string().trim().min(1).max(40).optional() });
export type Port = z.infer<typeof zPort>;

/** The Outils an Étape holds: what gives it a capability (a Rôle, a Commande, the Connecteur), and what is for its agent (a Skill, a Serveur MCP). */
export const zTool = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('role'), roleId: zRoleId }),
  z.strictObject({ kind: z.literal('skill'), skillId: z.string().regex(ID) }),
  z.strictObject({ kind: z.literal('mcp'), name: zName }),
  z.strictObject({ kind: z.literal('command'), commandId: zProcessId }),
  z.strictObject({ kind: z.literal('connector'), connector: z.literal('github') }),
]);
export type Tool = z.infer<typeof zTool>;
export type ToolKind = Tool['kind'];

export const zStep = z.strictObject({
  id: zProcessId,
  phaseId: zProcessId,
  kind: zStepKind,
  name: zName,
  col: zCell,
  row: zCell,
  inputs: z.array(zPort).max(8),
  outputs: z.array(zPort).max(4),
  tools: z.array(zTool).max(10),
});
export type Step = z.infer<typeof zStep>;

const zPortRef = z.strictObject({ stepId: zProcessId, portId: zProcessId });

/** From a Sortie to an Entrée of the same type. */
export const zArrow = z.strictObject({ from: zPortRef, to: zPortRef });
export type Arrow = z.infer<typeof zArrow>;

/** A Retour's maximum when the Pilote draws one. */
export const LOOP_BACK_MAX_DEFAULT = 3;

/** From an Étape that judges back to an earlier one of its Phase, taken at most `max` times per item. */
export const zLoopBack = z.strictObject({ from: zProcessId, to: zProcessId, max: z.int().min(1).max(10) });
export type LoopBack = z.infer<typeof zLoopBack>;

/** A Commande of the Process: its text, place and health address are in the sealed part, under the same id. */
export const zCommandRef = z.strictObject({ id: zProcessId });
export type CommandRef = z.infer<typeof zCommandRef>;

export const zProcessDefinition = z.strictObject({
  schemaVersion: z.literal(1),
  phases: z.array(zPhase).min(1).max(20),
  steps: z.array(zStep).max(200),
  arrows: z.array(zArrow).max(600),
  loopBacks: z.array(zLoopBack).max(50),
  commands: z.array(zCommandRef).max(50),
});
export type ProcessDefinition = z.infer<typeof zProcessDefinition>;

/**
 * The plaintext of a version's sealed part (a `SealedItem` of
 * `keys/sealed.ts`): each Commande's text, where it runs and its health
 * address. The browser seals it, the Runner opens it; the server never reads it.
 */
export const zProcessSealedPayload = z.strictObject({
  commands: z.record(
    zProcessId,
    z.strictObject({
      run: z.string().min(1).max(4000),
      where: z.enum(['project', 'worktree']),
      healthUrl: z.url({ protocol: /^https?$/ }).optional(),
    }),
  ),
});
export type ProcessSealedPayload = z.infer<typeof zProcessSealedPayload>;

/** The additional data of a Projet's sealed part. */
export const processSealAad = (projectId: string): string => `process:${projectId}`;
/** The additional data of a Modèle's sealed part. */
export const templateSealAad = (templateId: string): string => `template:${templateId}`;
