import { z } from 'zod';

/**
 * The types of a port: ADR 0011's Types d'artefact, by their ids, spelled as
 * `ARTIFACT_TYPES` (a test pins them equal).
 */
export const PORT_TYPES = ['idea', 'prd', 'mockups', 'technical-design', 'inventory', 'ticket', 'code-change', 'verdict', 'delivery'] as const;
export const zPortType = z.enum(PORT_TYPES);
export type PortType = z.infer<typeof zPortType>;
