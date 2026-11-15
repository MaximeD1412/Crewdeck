import { type ProcessDefinition, zProcessDefinition } from '@crewdeck/contracts';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Tx } from '../realtime/transactions.js';
import { registerRoleUsage } from '../settings/role-usage.js';
import { activeVersions } from './process.service.js';

/** The Étapes of `definition` whose Outils name `roleId`. */
export const stepsNamingRole = (definition: ProcessDefinition, roleId: string): number =>
  definition.steps.filter((step) => step.tools.some((tool) => tool.kind === 'role' && tool.roleId === roleId)).length;

/**
 * PARAM-2's `RoleUsage` over the Processes: the Étapes naming a Rôle in the
 * Pilote's active versions (each Projet's highest) and in their drafts, an
 * Étape in both counted in each.
 */
@Injectable()
export class ProcessRoleUsage implements OnModuleInit, OnModuleDestroy {
  private unregister: (() => void) | undefined;

  onModuleInit(): void {
    this.unregister = registerRoleUsage((tx, _pilotId, roleId) => this.count(tx, roleId));
  }

  onModuleDestroy(): void {
    this.unregister?.();
  }

  /** In the transaction's scope, that of the Pilote. */
  async count(tx: Pick<Tx, 'processVersion' | 'processDraft'>, roleId: string): Promise<number> {
    const [versions, drafts] = await Promise.all([activeVersions(tx), tx.processDraft.findMany({ select: { definition: true } })]);
    return [...versions, ...drafts].reduce((count, row) => count + stepsNamingRole(zProcessDefinition.parse(row.definition), roleId), 0);
  }
}
