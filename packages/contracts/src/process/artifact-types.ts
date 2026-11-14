import { z } from 'zod';

/**
 * The Types d'artefact (ADR 0011): what an Étape's Entrées take and its
 * Sorties give. An arrow only joins two ports of the same type.
 */
export const ARTIFACT_TYPES = ['idea', 'prd', 'mockups', 'technical-design', 'inventory', 'ticket', 'code-change', 'verdict', 'delivery'] as const;
export const zArtifactType = z.enum(ARTIFACT_TYPES);
export type ArtifactType = z.infer<typeof zArtifactType>;

/** The French name of each type, as the canvas and the Manques show it. */
export const ARTIFACT_TYPE_LABELS: Readonly<Record<ArtifactType, string>> = {
  idea: 'Idée',
  prd: 'PRD',
  mockups: 'Maquettes',
  'technical-design': 'Conception technique',
  inventory: 'Inventaire',
  ticket: 'Ticket',
  'code-change': 'Changement de code',
  verdict: 'Verdict',
  delivery: 'Livraison',
};
