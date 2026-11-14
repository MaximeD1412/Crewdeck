import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service.js';
import { runInPilotScope } from '../scope/scope.context.js';
import { parseEcbDaily } from './fx.js';
import { FX_SOURCE, type FxSource } from './fx-source.js';
import { UsageService } from './usage.service.js';
import { dateOf } from './usage.view.js';

/**
 * The euro reference rates (RUNNER-13): every day at 16:30 in Frankfurt,
 * after the ECB published the day's, the rate of the ECB's daily file is
 * stored, then the spends stored before any rate was known are converted.
 * At boot too, while no rate is known at all. A failure keeps the rates
 * already known: a day without its rate uses the last one.
 */
@Injectable()
export class FxRates implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    @Inject(FX_SOURCE) private readonly source: FxSource,
    @InjectPinoLogger(FxRates.name) private readonly logger: PinoLogger,
  ) {}

  onApplicationBootstrap(): void {
    // Never in the way of the boot: a database not there yet only logs.
    void Promise.resolve()
      .then(() => this.prisma.scoped.fxRate.count())
      .then((known) => (known === 0 ? this.run() : undefined))
      .catch((error: unknown) => this.logger.warn({ err: error }, 'fx rates at boot failed'));
  }

  // Frankfurt's time, where the ECB publishes: Germany's zone.
  @Cron('30 16 * * *', { name: 'fx-rates', timeZone: 'Europe/Berlin' })
  async run(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      this.logger.warn({ err: error }, 'fx rates failed');
    }
  }

  /** Stores the rate of the ECB's file, then converts what waited for one; throws when the file cannot be read. */
  async refresh(): Promise<void> {
    const { day, usdPerEur } = parseEcbDaily(await this.source.daily());
    const fetchedAt = new Date();
    await this.prisma.scoped.fxRate.upsert({ where: { day: dateOf(day) }, create: { day: dateOf(day), usdPerEur, fetchedAt }, update: { usdPerEur, fetchedAt } });
    this.logger.info({ day, usdPerEur }, 'fx rate');
    // Every Pilote's at once, by their ids only (ESLint allows this file); each converted in its own scope.
    const pilots = await this.prisma.unscoped.spend.findMany({ where: { costEurCents: null }, distinct: ['pilotId'], select: { pilotId: true } });
    for (const { pilotId } of pilots) await runInPilotScope(pilotId, () => this.usage.convertPending(pilotId));
  }
}
