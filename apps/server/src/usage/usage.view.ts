import { type UsageAccount, type UsageWindow, USAGE_WINDOWS } from '@crewdeck/contracts';
import type { AiAccountKind, EngineId, UsageWindowId } from '../generated/prisma/client.js';
import type { Tx } from '../realtime/transactions.js';
import { dayIn, monthOf } from './calendar.js';
import { PACE_OVER_MS, project } from './projection.js';

/** The models the usage reads, scoped to the Pilote. */
export type UsageTx = Pick<Tx, 'aiAccount' | 'usageMeasure' | 'spend' | 'pilot'>;

/** The ids as the contracts spell them (`five-hour`), Prisma's enums keeping `five_hour`. */
export const spelled = <T extends string>(value: string): T => value.replaceAll('_', '-') as T;
export const stored = <T extends string>(value: string): T => value.replaceAll('-', '_') as T;

/** A `YYYY-MM-DD` day as a `@db.Date` column takes it. */
export const dateOf = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/** The Comptes IA that have a usage: a subscription's windows, an API key's spend. */
const WITH_USAGE: AiAccountKind[] = ['subscription', 'api_key'];

interface AccountRow {
  id: string;
  engine: EngineId;
  kind: AiAccountKind;
}

const latest = (...dates: (Date | undefined)[]): Date | undefined =>
  dates.reduce<Date | undefined>((best, date) => (date && (!best || date > best) ? date : best), undefined);

/** A window's last measure, unless it has reset since, with its projection. */
const windowOf = async (tx: UsageTx, engine: EngineId, id: UsageWindow['id'], now: Date): Promise<UsageWindow | undefined> => {
  const window = stored<UsageWindowId>(id);
  const last = await tx.usageMeasure.findFirst({ where: { engine, window }, orderBy: { measuredAt: 'desc' } });
  if (!last || last.resetsAt <= now) return undefined;
  const measures = await tx.usageMeasure.findMany({ where: { engine, window, measuredAt: { gt: new Date(now.getTime() - PACE_OVER_MS) } } });
  const { exhaustsAt, holdsUntilReset, atReset } = project(id, measures, now);
  return {
    id,
    usedPercent: last.usedPercent,
    resetsAt: last.resetsAt.toISOString(),
    ...(exhaustsAt ? { exhaustsAt: exhaustsAt.toISOString() } : {}),
    holdsUntilReset,
    ...(atReset === null ? {} : { projectedPercent: atReset }),
    measuredAt: last.measuredAt.toISOString(),
  };
};

/** The spends of the calendar month of `now` in `timeZone`: their sum, the euros `null` while one is not converted. */
const monthSpendOf = async (tx: UsageTx, engine: EngineId, now: Date, timeZone: string): Promise<UsageAccount['monthSpend']> => {
  const { from, to } = monthOf(dayIn(now, timeZone));
  const where = { engine, day: { gte: dateOf(from), lt: dateOf(to) } };
  const [sum, unconverted] = await Promise.all([
    tx.spend.aggregate({ where, _sum: { costUsdMicros: true, costEurCents: true } }),
    tx.spend.count({ where: { ...where, costEurCents: null } }),
  ]);
  return {
    costUsdMicros: Number(sum._sum.costUsdMicros ?? 0n),
    costEurCents: unconverted > 0 ? null : Number(sum._sum.costEurCents ?? 0n),
  };
};

/** The usage of one Compte IA at `now`, `undefined` while it has neither a measure nor a spend. */
const usageOfAccount = async (tx: UsageTx, account: AccountRow, now: Date, timeZone: string): Promise<UsageAccount | undefined> => {
  const [measure, spend] = await Promise.all([
    tx.usageMeasure.findFirst({ where: { engine: account.engine }, orderBy: { measuredAt: 'desc' }, select: { measuredAt: true } }),
    tx.spend.findFirst({ where: { engine: account.engine }, orderBy: { measuredAt: 'desc' }, select: { measuredAt: true } }),
  ]);
  const measuredAt = latest(measure?.measuredAt, spend?.measuredAt);
  if (!measuredAt) return undefined;
  const windows: UsageWindow[] = [];
  for (const id of USAGE_WINDOWS) {
    const window = await windowOf(tx, account.engine, id, now);
    if (window) windows.push(window);
  }
  const monthSpend = account.kind === 'api_key' ? await monthSpendOf(tx, account.engine, now, timeZone) : undefined;
  return {
    id: account.id,
    engine: spelled(account.engine),
    kind: spelled(account.kind),
    windows,
    ...(monthSpend ? { monthSpend } : {}),
    measuredAt: measuredAt.toISOString(),
  };
};

const timeZoneOf = async (tx: UsageTx, pilotId: string): Promise<string> =>
  (await tx.pilot.findUniqueOrThrow({ where: { id: pilotId }, select: { timeZone: true } })).timeZone;

const ACCOUNT = { id: true, engine: true, kind: true } as const;

/** The usage of the Pilote's Comptes IA that have one (scoped by `tx`), in the order of the Moteurs' ids. */
export const listUsage = async (tx: UsageTx, pilotId: string, now: Date): Promise<UsageAccount[]> => {
  const timeZone = await timeZoneOf(tx, pilotId);
  const accounts = await tx.aiAccount.findMany({ where: { kind: { in: WITH_USAGE } }, select: ACCOUNT, orderBy: { engine: 'asc' } });
  const usage: UsageAccount[] = [];
  for (const account of accounts) {
    const one = await usageOfAccount(tx, account, now, timeZone);
    if (one) usage.push(one);
  }
  return usage;
};

/** The usage of the Pilote's Compte IA of `engine`, `undefined` without one that has a usage. */
export const usageOf = async (tx: UsageTx, pilotId: string, engine: EngineId, now: Date): Promise<UsageAccount | undefined> => {
  const account = await tx.aiAccount.findFirst({ where: { engine, kind: { in: WITH_USAGE } }, select: ACCOUNT });
  return account ? usageOfAccount(tx, account, now, await timeZoneOf(tx, pilotId)) : undefined;
};
