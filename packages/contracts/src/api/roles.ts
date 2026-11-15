import { z } from 'zod';
import { zAgentRole } from '../values.js';

/** A Rôle the Pilote added (PARAM-2): `r-` then 8 characters, drawn by the server. */
export const zCustomRoleId = z.string().regex(/^r-[a-z0-9]{8}$/);
export type CustomRoleId = z.infer<typeof zCustomRoleId>;

/** Any Rôle: one of the four defaults or one the Pilote added. */
export const zRoleId = z.union([zAgentRole, zCustomRoleId]);
export type RoleId = z.infer<typeof zRoleId>;
