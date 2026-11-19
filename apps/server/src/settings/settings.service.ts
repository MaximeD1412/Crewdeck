import {
  type AccountSettings,
  type AccountSettingsPatch,
  AGENT_ROLES,
  DEFAULT_ACCOUNT_SETTINGS,
  type EffectiveSettings,
  type RoleChoice,
  withDefaultRoles,
  zAccountSettings,
  zAgentRole,
} from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { AppError } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { identitiesOf, ME, toMe } from '../pilots/me.controller.js';
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

/** `settings` with what `patch` gives, and only that: role by role, step by step. */
export const patched = (settings: AccountSettings, patch: AccountSettingsPatch): AccountSettings => ({
  roles: { ...settings.roles, ...Object.fromEntries(roleChoices(patch)) },
  customRoles: settings.customRoles,
  optionalSteps: { ...settings.optionalSteps, ...patch.optionalSteps },
  notifications: { ...settings.notifications, ...patch.notifications },
  timeZone: patch.timeZone ?? settings.timeZone,
});

/** Whether `choice` is one of the models the Pilote's Runner can run now (`usableModels`). */
export const isUsableChoice = async (tx: Pick<Tx, 'aiAccount'>, choice: NonNullable<RoleChoice>): Promise<boolean> =>
  (await usableModels(tx)).some((model) => model.engine === choice.engine && model.id === choice.model);

/** The message of `fields.timeZone` when the zone is not one. */
export const UNKNOWN_TIME_ZONE = 'Fuseau horaire inconnu.';

/**
 * The Paramètres (PARAM-1): those of the account, the default of each Projet.
 * `effective` is the only function a module reads its settings with; PARAM-3
 * adds the Projet's own over the account's there.
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
    const stored = row ? { roles: row.roles, optionalSteps: row.optionalSteps, notifications: { push: row.notificationsPush } } : DEFAULT_ACCOUNT_SETTINGS;
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
   * The settings in effect for `projectId`, those of the account until a
   * Projet has its own (PARAM-3): each default Rôle left to its default gets
   * its computed Moteur and model (`withDefaultRoles`, from the Comptes IA the
   * Runner last reported). In the Pilote's scope.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- read once a Projet has its settings (PARAM-3)
  async effective(pilotId: string, _projectId?: string): Promise<EffectiveSettings> {
    const [account, accounts] = await Promise.all([this.account(pilotId), listAccounts(this.prisma.scoped)]);
    return { ...account, roles: withDefaultRoles(account.roles, accounts) };
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

  /** The settings as `tx` leaves them, written in `settings.upserted`. */
  async written(tx: Tx, pilotId: string): Promise<AccountSettings> {
    const settings = await this.account(pilotId, tx);
    await this.events.write(tx, pilotId, 'settings.upserted', settings);
    return settings;
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
    const row = { roles: defaults, optionalSteps: after.optionalSteps, notificationsPush: after.notifications.push };
    await tx.accountSettings.upsert({ where: { pilotId }, create: { pilotId, ...row }, update: row });
    for (const [roleId, choice] of choices) {
      if (zAgentRole.safeParse(roleId).success || !choice) continue;
      await tx.customRole.update({ where: { id: roleId }, data: { engine: storedEngine(choice.engine), model: choice.model }, select: { id: true } });
    }
    if (after.timeZone !== before.timeZone) {
      const pilot = await tx.pilot.update({ where: { id: pilotId }, data: { timeZone: after.timeZone }, select: ME });
      await this.events.write(tx, pilotId, 'pilot.upserted', toMe(pilot, await identitiesOf(tx)));
    }
    await this.events.write(tx, pilotId, 'settings.upserted', after);
    return after;
  }

  /** Refuses the Rôles' choices of a patch: those of an id not the Pilote's (400), `null` on a Rôle they added, a model the Runner cannot run (422). */
  private async validateRoles(tx: Tx, before: AccountSettings, choices: [string, RoleChoice][]): Promise<void> {
    const fields = (ids: string[], message: string) => Object.fromEntries(ids.map((id) => [`roles.${id}`, message]));
    const unknown = choices.filter(([roleId]) => !Object.hasOwn(before.roles, roleId)).map(([roleId]) => roleId);
    if (unknown.length > 0) throw new AppError(400, 'validation.invalid', MESSAGES['validation.invalid'], fields(unknown, MESSAGES['roles.not-found']));
    const required = choices.filter(([roleId, choice]) => choice === null && !zAgentRole.safeParse(roleId).success).map(([roleId]) => roleId);
    if (required.length > 0) {
      throw new AppError(422, 'settings.role-choice-required', MESSAGES['settings.role-choice-required'], fields(required, MESSAGES['settings.role-choice-required']));
    }
    if (!choices.some(([, choice]) => choice)) return;
    const usable = await usableModels(tx);
    const unusable = choices
      .filter(([, choice]) => choice && !usable.some((model) => model.engine === choice.engine && model.id === choice.model))
      .map(([roleId]) => roleId);
    if (unusable.length > 0) {
      throw new AppError(422, 'settings.engine-unusable', MESSAGES['settings.engine-unusable'], fields(unusable, MESSAGES['settings.engine-unusable']));
    }
  }
}
