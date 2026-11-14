import {
  type AccountSettings,
  type AccountSettingsPatch,
  DEFAULT_ACCOUNT_SETTINGS,
  type EffectiveSettings,
  zAccountSettings,
} from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { AppError } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { ME, toMe } from '../pilots/me.controller.js';
import { PrismaService, type ScopedPrisma } from '../prisma/prisma.service.js';
import { EventsWriter } from '../realtime/events.writer.js';
import type { Tx } from '../realtime/transactions.js';

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

/** `settings` with what `patch` gives, and only that: role by role, step by step. */
export const patched = (settings: AccountSettings, patch: AccountSettingsPatch): AccountSettings => ({
  roles: { ...settings.roles, ...patch.roles },
  optionalSteps: { ...settings.optionalSteps, ...patch.optionalSteps },
  notifications: { ...settings.notifications, ...patch.notifications },
  timeZone: patch.timeZone ?? settings.timeZone,
});

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

  /** The account's settings, the defaults for a Pilote who never changed any. Called in the Pilote's scope, or with its `tx`. */
  async account(pilotId: string, db: Tx | ScopedPrisma = this.prisma.scoped): Promise<AccountSettings> {
    const [pilot, row] = await Promise.all([
      db.pilot.findUnique({ where: { id: pilotId }, select: { timeZone: true } }),
      db.accountSettings.findUnique({ where: { pilotId } }),
    ]);
    if (!pilot) throw new AppError(401, 'auth.required', MESSAGES['auth.required']);
    const stored = row ? { roles: row.roles, optionalSteps: row.optionalSteps, notifications: { push: row.notificationsPush } } : DEFAULT_ACCOUNT_SETTINGS;
    return zAccountSettings.parse({ ...stored, timeZone: pilot.timeZone });
  }

  /** The settings in effect for `projectId`, those of the account until a Projet has its own (PARAM-3). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- read once a Projet has its settings (PARAM-3)
  async effective(pilotId: string, _projectId?: string): Promise<EffectiveSettings> {
    return this.account(pilotId);
  }

  /**
   * Writes what `patch` changes, with its `settings.upserted` (and
   * `pilot.upserted` when the time zone changes) in the same `tx`; returns the
   * settings. 400 on a zone that is not one. Concurrent updates of a Pilote
   * are serialised on their row, so none loses a field another one changed.
   */
  async update(tx: Tx, pilotId: string, patch: AccountSettingsPatch): Promise<AccountSettings> {
    if (patch.timeZone !== undefined && !isKnownTimeZone(patch.timeZone)) {
      throw new AppError(400, 'validation.invalid', MESSAGES['validation.invalid'], { timeZone: UNKNOWN_TIME_ZONE });
    }
    // The Pilote's row locked before the read, row of settings or not yet (the
    // lock `EventsWriter` takes later; the scoped client has no raw `FOR
    // UPDATE`): two PATCHes run one after the other, the second merging over
    // what the first wrote.
    await tx.pilot.update({ where: { id: pilotId }, data: { seq: { increment: 0 } }, select: { id: true } });
    const before = await this.account(pilotId, tx);
    const after = patched(before, patch);
    const row = { roles: after.roles, optionalSteps: after.optionalSteps, notificationsPush: after.notifications.push };
    await tx.accountSettings.upsert({ where: { pilotId }, create: { pilotId, ...row }, update: row });
    if (after.timeZone !== before.timeZone) {
      const pilot = await tx.pilot.update({ where: { id: pilotId }, data: { timeZone: after.timeZone }, select: ME });
      await this.events.write(tx, pilotId, 'pilot.upserted', toMe(pilot));
    }
    await this.events.write(tx, pilotId, 'settings.upserted', after);
    return after;
  }
}
