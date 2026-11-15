import type { Tx } from '../realtime/transactions.js';

/**
 * How many Étapes of a Pilote's Processes name a Rôle (PARAM-2's 409
 * `roles.in-use`): each module holding Étapes registers its provider, and
 * removing a Rôle asks them all. Until PARAM-2's `DELETE /api/roles/:id`,
 * PROCESS-3's provider (versions and drafts) is the one registered.
 */
export type RoleUsageProvider = (tx: Tx, pilotId: string, roleId: string) => Promise<number>;

const providers = new Set<RoleUsageProvider>();

/** Registers `provider`; returns what unregisters it (a module destroyed, a test). */
export const registerRoleUsage = (provider: RoleUsageProvider): (() => void) => {
  providers.add(provider);
  return () => {
    providers.delete(provider);
  };
};

/** The Étapes naming `roleId`, over every provider registered: 0 when none counts it. */
export const roleUsage = async (tx: Tx, pilotId: string, roleId: string): Promise<number> => {
  let count = 0;
  for (const provider of providers) count += await provider(tx, pilotId, roleId);
  return count;
};
