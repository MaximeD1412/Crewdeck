import type { ProcessTemplate, SealedItem } from '@crewdeck/contracts';
import { zSealedItem } from '@crewdeck/contracts';

/** What of a `process_templates` row the view reads: its definition only to count its Commandes. */
export const PROCESS_TEMPLATE_VIEW = {
  id: true,
  name: true,
  fromProjectId: true,
  fromVersionNumber: true,
  definition: true,
  sealed: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface ProcessTemplateRow {
  readonly id: string;
  readonly name: string;
  readonly fromProjectId: string | null;
  readonly fromVersionNumber: number;
  readonly definition: unknown;
  readonly sealed: unknown;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const sealedOf = (value: unknown): SealedItem | null => (value === null || value === undefined ? null : zSealedItem.parse(value));

/** How many Commandes a stored definition names. */
export const commandCountOf = (definition: unknown): number => {
  const commands = (definition as { commands?: unknown } | null)?.commands;
  return Array.isArray(commands) ? commands.length : 0;
};

/** A Modèle as the slice, the routes and `process-template.upserted` carry it: never its definition. */
export const toProcessTemplate = (row: ProcessTemplateRow): ProcessTemplate => ({
  id: row.id,
  name: row.name,
  fromProjectId: row.fromProjectId,
  fromVersionNumber: row.fromVersionNumber,
  sealed: sealedOf(row.sealed),
  commandCount: commandCountOf(row.definition),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
