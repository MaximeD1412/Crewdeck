import {
  type AccountSettings,
  type AccountSettingsPatch,
  AGENT_ROLES,
  type AiAccount,
  DEFAULT_ACCOUNT_SETTINGS,
  type EffectiveSettings,
  type ProjectSettings,
  type ProjectSettingsOverrides,
  type RoleChoice,
  type SettingOrigin,
  withDefaultRoles,
  zAccountSettings,
  zAgentRole,
  zProjectSettingsOverrides,
  zSealedItem,
} from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { AppError } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { ME, toMe } from '../pilots/me.controller.js';
import { PrismaService, type ScopedPrisma } from '../prisma/prisma.service.js';
import { EventsWriter } from '../realtime/events.writer.js';
import type { Tx } from '../realtime/transactions.js';
import { spelledEngine, storedEngine } from '../runners/ai-accounts/ai-account.view.js';
import { listAccounts, usableModels } from '../runners/ai-accounts/ai-accounts.js';

const IANA_ZONES: ReadonlySet<string> = new Set(Intl.supportedValuesOf('timeZone'));

/**
 * A time zone the Planifications and the per-day statistics can compute with:
 * an IANA zone, or another name of one (`UTC`, `Asia/Kolkata`, which a browser
 * may give while Node lists `Asia/Calcutta`). An offset is not a zone.
 */
export const isKnownTimeZone = (zone: string): boolean => {
  if (IANA_ZONES.has(zone)) return true;
  try {
    const resolved = new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
    return resolved === 'UTC' || IANA_ZONES.has(resolved);
  } catch {
    return false;
  }
};

/** The Rôles' choices `patch` gives, by Rôle id. */
const roleChoices = (patch: AccountSettingsPatch): [string, RoleChoice][] =>
  Object.entries(patch.roles ?? {}).filter((entry): entry is [string, RoleChoice] => entry[1] !== undefined);

/** `settings` with what `patch` gives, and only that: role by role. */
export const patched = (settings: AccountSettings, patch: AccountSettingsPatch): AccountSettings => ({
  roles: { ...settings.roles, ...Object.fromEntries(roleChoices(patch)) },
  customRoles: settings.customRoles,
  notifications: { ...settings.notifications, ...patch.notifications },
  timeZone: patch.timeZone ?? settings.timeZone,
});

/** Nothing changed for a Projet: everything inherited. */
export const NO_OVERRIDES: ProjectSettingsOverrides = { roles: {}, notifications: {} };

/** What a `project_settings` row changed, none without a row. */
export const overridesOf = (row: { roles: unknown; notificationsPush: boolean | null } | null): ProjectSettingsOverrides =>
  row
    ? zProjectSettingsOverrides.parse({ roles: row.roles, notifications: row.notificationsPush === null ? {} : { push: row.notificationsPush } })
    : NO_OVERRIDES;

/** A Projet's settings over the account's, before the defaults: where each comes from, and how many it changed. */
export interface MergedSettings {
  readonly settings: AccountSettings;
  readonly origins: ProjectSettings['origins'];
  readonly changedCount: number;
}

/**
 * The account's settings with what a Projet changed (pure, US-82): each Rôle
 * of the account its override, else the account's choice (still `null` for
 * a default left to its default, `withDefaultRoles` computing it after the
 * merge); an override of a Rôle the account no longer has is ignored. Push is
 * on only when the account's and the Projet's are: the account's off wins.
 * An override counts as changed even when equal to the account's value.
 */
export const mergeSettings = (account: AccountSettings, overrides: ProjectSettingsOverrides): MergedSettings => {
  const roles: AccountSettings['roles'] = { ...account.roles };
  const origins: Record<string, SettingOrigin> = {};
  for (const [roleId, choice] of Object.entries(account.roles)) {
    const override = Object.hasOwn(overrides.roles, roleId) ? overrides.roles[roleId] : undefined;
    roles[roleId] = override ?? choice;
    origins[roleId] = override ? 'projet' : 'compte';
  }
  const push = overrides.notifications.push;
  return {
    settings: { ...account, roles, notifications: { push: account.notifications.push && push !== false } },
    origins: { roles: origins, notifications: { push: push === undefined ? 'compte' : 'projet' } },
    changedCount: Object.values(origins).filter((origin) => origin === 'projet').length + (push === undefined ? 0 : 1),
  };
};

/** What of a Projet its Paramètres read, beside the account's. */
const PROJECT_SETTINGS_ROW = {
  id: true,
  integrationBranch: true,
  releaseBranch: true,
  settings: { select: { roles: true, notificationsPush: true, worktreeCommands: true } },
} as const;

interface ProjectSettingsRow {
  readonly id: string;
  readonly integrationBranch: string;
  readonly releaseBranch: string;
  readonly settings: { roles: unknown; notificationsPush: boolean | null; worktreeCommands: unknown } | null;
}

/** `GET /api/projects/:id/settings` of `project` (pure): its settings in effect, their origins, its branches, its sealed worktree Commandes. */
export const projectSettingsOf = (account: AccountSettings, accounts: readonly AiAccount[], project: ProjectSettingsRow): ProjectSettings => {
  const { settings, origins, changedCount } = mergeSettings(account, overridesOf(project.settings));
  const sealed = project.settings?.worktreeCommands;
  return {
    projectId: project.id,
    effective: { ...settings, roles: withDefaultRoles(settings.roles, accounts) },
    origins,
    changedCount,
    branches: { integration: project.integrationBranch, release: project.releaseBranch },
    worktreeCommands: sealed === null || sealed === undefined ? null : zSealedItem.parse(sealed),
  };
};

/** Whether `choice` is one of the models the Pilote's Runner can run now (`usableModels`). */
export const isUsableChoice = async (tx: Pick<Tx, 'aiAccount'>, choice: NonNullable<RoleChoice>): Promise<boolean> =>
  (await usableModels(tx)).some((model) => model.engine === choice.engine && model.id === choice.model);

/** The message of `fields.timeZone` when the zone is not one. */
export const UNKNOWN_TIME_ZONE = 'Fuseau horaire inconnu.';

/**
 * The Paramètres (PARAM-1, PARAM-3): those of the account, the default of
 * each Projet, and what each Projet changed over them. `effective` is the
 * only function a module reads its settings with.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsWriter,
  ) {}

  /**
   * The account's settings, the defaults for a Pilote who never changed any:
   * the four default Rôles as stored (`null`, their default), then each Rôle
   * the Pilote added with its choice. Called in the Pilote's scope, or with its `tx`.
   */
  async account(pilotId: string, db: Tx | ScopedPrisma = this.prisma.scoped): Promise<AccountSettings> {
    const [pilot, row, customRoles] = await Promise.all([
      db.pilot.findUnique({ where: { id: pilotId }, select: { timeZone: true } }),
      db.accountSettings.findUnique({ where: { pilotId } }),
      db.customRole.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, name: true, engine: true, model: true, createdAt: true } }),
    ]);
    if (!pilot) throw new AppError(401, 'auth.required', MESSAGES['auth.required']);
    const stored = row ? { roles: row.roles, notifications: { push: row.notificationsPush } } : DEFAULT_ACCOUNT_SETTINGS;
    const defaults = stored.roles as Record<string, RoleChoice>;
    const roles = {
      ...Object.fromEntries(AGENT_ROLES.map((role) => [role, defaults[role] ?? null])),
      ...Object.fromEntries(customRoles.map((role) => [role.id, { engine: spelledEngine(role.engine), model: role.model }])),
    };
    return zAccountSettings.parse({
      ...stored,
      roles,
      customRoles: customRoles.map(({ id, name, createdAt }) => ({ id, name, createdAt: createdAt.toISOString() })),
      timeZone: pilot.timeZone,
    });
  }

  /**
   * The settings in effect for `projectId`, or for the account without one:
   * what the Projet changed over the account's (`mergeSettings`; a Projet
   * that is not the Pilote's changed nothing), then each Rôle left to its
   * default gets its computed Moteur and model (`withDefaultRoles`, from the
   * Comptes IA the Runner last reported), so that a Projet whose Code is
   * overridden gets a Review on another Moteur than its own Code. In the
   * Pilote's scope.
   */
  async effective(pilotId: string, projectId?: string): Promise<EffectiveSettings> {
    const db = this.prisma.scoped;
    const [account, accounts, row] = await Promise.all([
      this.account(pilotId),
      listAccounts(db),
      projectId ? db.projectSettings.findFirst({ where: { projectId }, select: { roles: true, notificationsPush: true } }) : null,
    ]);
    const { settings } = mergeSettings(account, overridesOf(row));
    return { ...settings, roles: withDefaultRoles(settings.roles, accounts) };
  }

  /** The Paramètres of the Pilote's Projet `projectId`, `null` for a Projet that is not theirs. In the Pilote's scope, or with its `tx`. */
  async project(pilotId: string, projectId: string, db: Tx | ScopedPrisma = this.prisma.scoped): Promise<ProjectSettings | null> {
    const [account, accounts, project] = await Promise.all([
      this.account(pilotId, db),
      listAccounts(db),
      db.project.findFirst({ where: { id: projectId }, select: PROJECT_SETTINGS_ROW }),
    ]);
    return project ? projectSettingsOf(account, accounts, project) : null;
  }

  /** The Paramètres of each of the Pilote's Projets, in the order they followed them: the `settings` slice's `projects`. */
  async projects(pilotId: string, db: Tx | ScopedPrisma = this.prisma.scoped): Promise<ProjectSettings[]> {
    const [account, accounts, projects] = await Promise.all([
      this.account(pilotId, db),
      listAccounts(db),
      db.project.findMany({ orderBy: [{ followedAt: 'asc' }, { id: 'asc' }], select: PROJECT_SETTINGS_ROW }),
    ]);
    return projects.map((project) => projectSettingsOf(account, accounts, project));
  }

  /** The `settings` slice of `GET /api/state`: the account's, and each Projet's. */
  async state(pilotId: string, db: Tx | ScopedPrisma = this.prisma.scoped): Promise<AccountSettings & { projects: ProjectSettings[] }> {
    const [account, projects] = await Promise.all([this.account(pilotId, db), this.projects(pilotId, db)]);
    return { ...account, projects };
  }

  /**
   * Locks the Pilote's row for the rest of `tx`, row of settings or not yet
   * (the lock `EventsWriter` takes later; the scoped client has no raw `FOR
   * UPDATE`): two changes of a Pilote's settings run one after the other, the
   * second reading what the first wrote.
   */
  async lock(tx: Tx, pilotId: string): Promise<void> {
    await tx.pilot.update({ where: { id: pilotId }, data: { seq: { increment: 0 } }, select: { id: true } });
  }

  /**
   * The settings as `tx` leaves them, written in `settings.upserted`, then
   * those of each Projet, which inherit them, each in its own.
   */
  async written(tx: Tx, pilotId: string): Promise<AccountSettings> {
    const settings = await this.account(pilotId, tx);
    await this.events.write(tx, pilotId, 'settings.upserted', settings);
    await this.projectsWritten(tx, pilotId);
    return settings;
  }

  /** The Paramètres of each Projet as `tx` leaves them, each in a `settings.upserted` `{ projectSettings }`. */
  private async projectsWritten(tx: Tx, pilotId: string): Promise<void> {
    for (const projectSettings of await this.projects(pilotId, tx)) await this.events.write(tx, pilotId, 'settings.upserted', { projectSettings });
  }

  /**
   * Writes what `patch` changes, with its `settings.upserted` (and
   * `pilot.upserted` when the time zone changes) in the same `tx`; returns the
   * settings. 400 on a zone that is not one or a Rôle that is not the
   * Pilote's; 422 `settings.role-choice-required` for `null` on a Rôle the
   * Pilote added, `settings.engine-unusable` for a model the Runner cannot
   * run. Concurrent updates of a Pilote are serialised on their row, so none
   * loses a field another one changed.
   */
  async update(tx: Tx, pilotId: string, patch: AccountSettingsPatch): Promise<AccountSettings> {
    if (patch.timeZone !== undefined && !isKnownTimeZone(patch.timeZone)) {
      throw new AppError(400, 'validation.invalid', MESSAGES['validation.invalid'], { timeZone: UNKNOWN_TIME_ZONE });
    }
    await this.lock(tx, pilotId);
    const before = await this.account(pilotId, tx);
    const choices = roleChoices(patch);
    await this.validateRoles(tx, before, choices);
    const after = patched(before, patch);
    const defaults = Object.fromEntries(AGENT_ROLES.map((role) => [role, after.roles[role]]));
    const row = { roles: defaults, notificationsPush: after.notifications.push };
    await tx.accountSettings.upsert({ where: { pilotId }, create: { pilotId, ...row }, update: row });
    for (const [roleId, choice] of choices) {
      if (zAgentRole.safeParse(roleId).success || !choice) continue;
      await tx.customRole.update({ where: { id: roleId }, data: { engine: storedEngine(choice.engine), model: choice.model }, select: { id: true } });
    }
    if (after.timeZone !== before.timeZone) {
      const pilot = await tx.pilot.update({ where: { id: pilotId }, data: { timeZone: after.timeZone }, select: ME });
      await this.events.write(tx, pilotId, 'pilot.upserted', toMe(pilot));
    }
    await this.events.write(tx, pilotId, 'settings.upserted', after);
    await this.projectsWritten(tx, pilotId);
    return after;
  }

  /** Refuses the Rôles' choices of a patch of the account: `validateRoleChoices`, and `null` on a Rôle the Pilote added (422). */
  private async validateRoles(tx: Tx, before: AccountSettings, choices: [string, RoleChoice][]): Promise<void> {
    await validateRoleChoices(tx, before, choices, { nullable: (roleId) => zAgentRole.safeParse(roleId).success });
  }
}

const roleFields = (ids: string[], message: string) => Object.fromEntries(ids.map((id) => [`roles.${id}`, message]));

/**
 * Refuses the Rôles' choices of a patch (PARAM-2, PARAM-3), on each Rôle's
 * field `roles.<id>`: an id that is not one of the account's Rôles (400),
 * `null` where `nullable` says no (422 `settings.role-choice-required`), a
 * model the Runner cannot run (422 `settings.engine-unusable`).
 */
export const validateRoleChoices = async (
  tx: Pick<Tx, 'aiAccount'>,
  account: AccountSettings,
  choices: [string, RoleChoice][],
  { nullable }: { nullable: (roleId: string) => boolean },
): Promise<void> => {
  const unknown = choices.filter(([roleId]) => !Object.hasOwn(account.roles, roleId)).map(([roleId]) => roleId);
  if (unknown.length > 0) throw new AppError(400, 'validation.invalid', MESSAGES['validation.invalid'], roleFields(unknown, MESSAGES['roles.not-found']));
  const required = choices.filter(([roleId, choice]) => choice === null && !nullable(roleId)).map(([roleId]) => roleId);
  if (required.length > 0) {
    throw new AppError(422, 'settings.role-choice-required', MESSAGES['settings.role-choice-required'], roleFields(required, MESSAGES['settings.role-choice-required']));
  }
  if (!choices.some(([, choice]) => choice)) return;
  const usable = await usableModels(tx);
  const unusable = choices
    .filter(([, choice]) => choice && !usable.some((model) => model.engine === choice.engine && model.id === choice.model))
    .map(([roleId]) => roleId);
  if (unusable.length > 0) {
    throw new AppError(422, 'settings.engine-unusable', MESSAGES['settings.engine-unusable'], roleFields(unusable, MESSAGES['settings.engine-unusable']));
  }
};

