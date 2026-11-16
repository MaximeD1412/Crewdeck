import { randomInt } from 'node:crypto';
import {
  type AccountSettings,
  AGENT_ROLES,
  type AgentRole,
  checkRole,
  CUSTOM_ROLES_MAX,
  type CreateRole,
  type RoleCheck,
  type RoleChoice,
  zAgentRole,
  zCustomRoleId,
} from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { AppError, notFound, unprocessable } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Tx } from '../realtime/transactions.js';
import { storedEngine } from '../runners/ai-accounts/ai-account.view.js';
import { listAccounts } from '../runners/ai-accounts/ai-accounts.js';
import { roleUsage } from './role-usage.js';
import { isUsableChoice, SettingsService } from './settings.service.js';

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A new Rôle's id: `r-` then 8 random characters (36^8), never reused (the key is global). */
export const newCustomRoleId = (): string => `r-${Array.from({ length: 8 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join('')}`;

/** What two names that are the same Rôle share: trimmed, lower-cased. */
export const roleNameKey = (name: string): string => name.trim().toLocaleLowerCase('fr');

/** The names of the default Rôles, as the page shows them: a Rôle the Pilote adds cannot take one. */
export const DEFAULT_ROLE_NAMES: Readonly<Record<AgentRole, string>> = { idea: 'Idée', design: 'Conception', code: 'Code', review: 'Review' };

const RESERVED_KEYS: ReadonlySet<string> = new Set(AGENT_ROLES.map((role) => roleNameKey(DEFAULT_ROLE_NAMES[role])));

const isUniqueViolation = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const nameTaken = (): AppError => new AppError(409, 'roles.name-taken', MESSAGES['roles.name-taken'], { name: MESSAGES['roles.name-taken'] });

/**
 * The Rôles (PARAM-2): the four default ones, never removed, and up to 20 the
 * Pilote adds, each with its own Moteur and model. `check` says whether each
 * can run on the Pilote's Runner (US-4's « Un Moteur utilisable par Rôle »);
 * `create` and `remove` change the set of ids, with `settings.upserted`.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Whether each of `roleIds` (every Rôle of the Pilote's by default) can run, from its effective choice; an unknown id has no Moteur. In the Pilote's scope. */
  async check(pilotId: string, { projectId, roleIds }: { projectId?: string; roleIds?: readonly string[] } = {}): Promise<RoleCheck[]> {
    const [settings, accounts] = await Promise.all([this.settings.effective(pilotId, projectId), listAccounts(this.prisma.scoped)]);
    const roles: Record<string, RoleChoice> = settings.roles;
    return (roleIds ?? Object.keys(roles)).map((roleId) => checkRole(roleId, Object.hasOwn(roles, roleId) ? roles[roleId] : undefined, accounts));
  }

  /**
   * Adds the Rôle `body` names on its Moteur and model; returns the settings.
   * 409 `roles.name-taken` (case-insensitive, the default names included),
   * 422 `roles.too-many` past 20, 422 `settings.engine-unusable` for a model
   * the Runner cannot run.
   */
  async create(tx: Tx, pilotId: string, body: CreateRole): Promise<AccountSettings> {
    await this.settings.lock(tx, pilotId);
    const nameKey = roleNameKey(body.name);
    if (RESERVED_KEYS.has(nameKey) || (await tx.customRole.count({ where: { nameKey } })) > 0) throw nameTaken();
    if ((await tx.customRole.count()) >= CUSTOM_ROLES_MAX) throw unprocessable('roles.too-many', MESSAGES['roles.too-many']);
    if (!(await isUsableChoice(tx, body))) {
      throw new AppError(422, 'settings.engine-unusable', MESSAGES['settings.engine-unusable'], { model: MESSAGES['settings.engine-unusable'] });
    }
    try {
      await tx.customRole.create({ data: { id: newCustomRoleId(), pilotId, name: body.name, nameKey, engine: storedEngine(body.engine), model: body.model } });
    } catch (error) {
      // The Pilote's row is locked: only a concurrent request outside this lock could get here.
      if (isUniqueViolation(error)) throw nameTaken();
      throw error;
    }
    return this.settings.written(tx, pilotId);
  }

  /**
   * Removes the Rôle `roleId` the Pilote added; returns the settings. 422
   * `roles.default` for a default Rôle, 404 `roles.not-found` for one that is
   * not the Pilote's, 409 `roles.in-use` while an Étape names it.
   */
  async remove(tx: Tx, pilotId: string, roleId: string): Promise<AccountSettings> {
    if (zAgentRole.safeParse(roleId).success) throw unprocessable('roles.default', MESSAGES['roles.default']);
    const missing = () => notFound('roles.not-found', MESSAGES['roles.not-found']);
    if (!zCustomRoleId.safeParse(roleId).success) throw missing();
    await this.settings.lock(tx, pilotId);
    if (!(await tx.customRole.findFirst({ where: { id: roleId }, select: { id: true } }))) throw missing();
    if ((await roleUsage(tx, pilotId, roleId)) > 0) throw new AppError(409, 'roles.in-use', MESSAGES['roles.in-use']);
    await tx.customRole.deleteMany({ where: { id: roleId } });
    return this.settings.written(tx, pilotId);
  }
}
