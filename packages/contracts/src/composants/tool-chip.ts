import { z } from 'zod';
import { defineComposant } from './define.js';

/** What an Outil is: a Rôle, a Skill, a Serveur MCP, a Commande or the Connecteur (ADR 0011). */
export const TOOL_CHIP_KINDS = ['role', 'skill', 'mcp', 'command', 'connector'] as const;

/**
 * An Outil on an Étape's card: its kind's icon and its name in mono; the
 * kind's name (`toolChip.kind.<kind>`) for screen readers.
 */
export const ToolChip = defineComposant({
  name: 'ToolChip',
  version: 1,
  tag: 'cd-tool-chip',
  category: 'partie',
  description: 'Un Outil d’une Étape : l’icône de son genre et son nom.',
  data: z.object({ kind: z.enum(TOOL_CHIP_KINDS), label: z.string() }),
  actions: {},
  slots: [],
  examples: [
    { name: 'un Rôle', data: { kind: 'role', label: 'Conception' } },
    { name: 'un Skill', data: { kind: 'skill', label: 'product-design' } },
    { name: 'un Serveur MCP', data: { kind: 'mcp', label: 'figma' } },
    { name: 'une Commande', data: { kind: 'command', label: 'pnpm test' } },
    { name: 'le Connecteur', data: { kind: 'connector', label: 'GitHub' } },
  ],
});
