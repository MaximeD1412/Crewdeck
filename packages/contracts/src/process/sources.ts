import { z } from 'zod';
import type { ArtifactType } from './artifact-types.js';

/**
 * A Projet's Sources as the Process's rules see them (ADR 0012, « Which
 * Source for what »): one choice per group, `null` while none is chosen.
 * The table that holds them is SOURCE-1's; `findGaps` only reads them.
 */

/** `ticket`: the Tickets; `code`: the Changement de code and the documents, files of the code's repository. */
export const SOURCE_GROUPS = ['ticket', 'code'] as const;
export const zSourceGroup = z.enum(SOURCE_GROUPS);
export type SourceGroup = z.infer<typeof zSourceGroup>;

export const SOURCE_KINDS = ['local', 'github'] as const;
export const zSourceKind = z.enum(SOURCE_KINDS);
export type SourceKind = z.infer<typeof zSourceKind>;

export const zProcessSources = z.strictObject({ ticket: zSourceKind.nullable(), code: zSourceKind.nullable() });
export type ProcessSources = Record<SourceGroup, SourceKind | null>;

/**
 * Where each Type d'artefact lives: a group's Source, Crewdeck itself (the
 * Idée), or nowhere (the Livraison, a Commande's result in Crewdeck's
 * state). The Verdict lives where the Changement de code lives.
 */
export const TYPE_SOURCE: Readonly<Record<ArtifactType, SourceGroup | 'crewdeck' | 'none'>> = {
  idea: 'crewdeck',
  prd: 'code',
  mockups: 'code',
  'technical-design': 'code',
  inventory: 'code',
  ticket: 'ticket',
  'code-change': 'code',
  verdict: 'code',
  delivery: 'none',
};
