import type { Usage } from '@crewdeck/contracts';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { EngineId, UsageWindowId } from '../generated/prisma/client.js';
import { newId } from '../ids.js';
import { EventsWriter } from '../realtime/events.writer.js';
import { Transactions, type Tx } from '../realtime/transactions.js';
import { RunnerClock } from '../runners/clock.js';
import { RunnerDispatcher } from '../runners/runner-dispatcher.js';
import { dayIn } from './calendar.js';
import { type FxRateOfDay, toEurCents } from './fx.js';
import { dateOf, stored, usageOf } from './usage.view.js';

const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

/** The rates as `toEurCents` reads them: the one of `day` or the last before it, or every one without `day`. */
const ratesUpTo = async (tx: Pick<Tx, 'fxRate'>, day?: string): Promise<FxRateOfDay[]> => {
  const rows = day
    ? await tx.fxRate.findMany({ where: { day: { lte: dateOf(day) } }, orderBy: { day: 'desc' }, take: 1 })
    : await tx.fxRate.findMany();
  return rows.map((row) => ({ day: dayOf(row.day), usdPerEur: row.usdPerEur.toString() }));
};

/**
 * The usage of the Comptes IA (US-55, RUNNER-13): each `usage` message of the
 * Pilote's Runner stores its windows' measures and an API key's spend
 * (converted in euros at its day's rate, the day in the Pilote's time zone),
 * with `usage.upserted`, in one transaction. A subscription's spend is not
 * kept: its cost is a share of its windows.
 */
@Injectable()
export class UsageService implements OnModuleInit {
  constructor(
    private readonly dispatcher: RunnerDispatcher,
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly clock: RunnerClock,
  ) {}

  onModuleInit(): void {
    this.dispatcher.registerRunnerHandler('usage', (message, context) => this.record(context.pilotId, message));
  }

  /**
   * Stores what the Runner measured of one Compte IA. A spend is stored
   * under its message's id: the Runner sends a spend again until it knows the
   * server got it, a restart included, and the second one changes nothing.
   */
  record(pilotId: string, usage: Omit<Usage, 'type' | 'at'>): Promise<void> {
    const engine = stored<EngineId>(usage.engine);
    const measuredAt = new Date(usage.measuredAt);
    return this.transactions.run(async (tx) => {
      if (usage.windows.length > 0) {
        await tx.usageMeasure.createMany({
          data: usage.windows.map((window) => ({
            id: newId(),
            pilotId,
            engine,
            window: stored<UsageWindowId>(window.id),
            usedPercent: window.usedPercent,
            resetsAt: new Date(window.resetsAt),
            measuredAt,
          })),
        });
      }
      let spend = usage.accountKind === 'api-key' ? usage.spend : undefined;
      if (spend) {
        const { timeZone } = await tx.pilot.findUniqueOrThrow({ where: { id: pilotId }, select: { timeZone: true } });
        const day = dayIn(measuredAt, timeZone);
        const costEurCents = toEurCents(spend.costUsdMicros, day, await ratesUpTo(tx, day));
        const { count } = await tx.spend.createMany({
          skipDuplicates: true,
          data: {
            id: usage.id,
            pilotId,
            engine,
            // The Session the Runner names; its Projet and its StepRun come
            // from it once Sessions are stored (RUNNER-9, #47): until then a
            // spend counts in the month only.
            projectId: null,
            sessionId: spend.sessionId ?? null,
            stepRunId: null,
            day: dateOf(day),
            costUsdMicros: BigInt(spend.costUsdMicros),
            costEurCents: costEurCents === null ? null : BigInt(costEurCents),
            measuredAt,
          },
        });
        if (count === 0) spend = undefined; // stored already
      }
      if (usage.windows.length === 0 && !spend) return;
      await this.publish(tx, pilotId, engine);
    });
  }

  /**
   * Converts the Pilote's spends stored before any rate was known for their
   * day, with `usage.upserted` for each Compte IA they change; the rate job
   * calls it, in the Pilote's scope, once it stored a rate.
   */
  convertPending(pilotId: string): Promise<void> {
    return this.transactions.run(async (tx) => {
      const pending = await tx.spend.findMany({ where: { costEurCents: null } });
      if (pending.length === 0) return;
      const rates = await ratesUpTo(tx);
      const changed = new Set<EngineId>();
      for (const spend of pending) {
        const costEurCents = toEurCents(Number(spend.costUsdMicros), dayOf(spend.day), rates);
        if (costEurCents === null) continue;
        await tx.spend.update({ where: { id: spend.id }, data: { costEurCents: BigInt(costEurCents) } });
        changed.add(spend.engine);
      }
      for (const engine of changed) await this.publish(tx, pilotId, engine);
    });
  }

  private async publish(tx: Tx, pilotId: string, engine: EngineId): Promise<void> {
    const account = await usageOf(tx, pilotId, engine, this.clock.now());
    if (account) await this.events.write(tx, pilotId, 'usage.upserted', account);
  }
}
