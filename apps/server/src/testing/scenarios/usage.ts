import { Prisma } from '../../generated/prisma/client.js';
import { newId } from '../../ids.js';
import { dateOf } from '../../usage/usage.view.js';
import { dayIn } from '../../usage/calendar.js';
import type { ScenarioContext } from './define.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The ECB's rate of the mockup's day: 23.41872 $ make 21,60 €. */
const USD_PER_EUR = '1.0842';
const CODEX_MONTH_USD_MICROS = 23_418_720n;
const CODEX_MONTH_EUR_CENTS = 2160n;

/**
 * The usage of the mockups (`design/screens/crewdeck/runner.html`), from now:
 * Claude's 5-hour window used up, resetting in 1 h 28 (16:40 for the
 * mockup's 15:12); its week at 62 %, resetting in 4 days and a half, at a
 * pace over the last 6 hours that runs out in about 2 days; Codex's spend
 * of the month, 21,60 € at the day's rate. `lastMeasureAt`: the Runner went
 * offline then, its measures are the last it sent (one per window, no pace).
 */
export const seedUsage = async (ctx: ScenarioContext, pilotId: string, { lastMeasureAt }: { lastMeasureAt?: Date } = {}) => {
  const now = Date.now();
  const fiveHourResets = new Date(now + 88 * MINUTE);
  const weekResets = new Date(now + 4.5 * DAY);
  const last = lastMeasureAt ?? new Date(now - 10 * MINUTE);
  const measures = (window: 'five_hour' | 'week', resetsAt: Date, points: readonly [Date, number][]) =>
    points.map(([measuredAt, usedPercent]) => ({ id: newId(), pilotId, engine: 'claude_code' as const, window, usedPercent, resetsAt, measuredAt }));
  await ctx.prisma.unscoped.usageMeasure.createMany({
    data: lastMeasureAt
      ? [...measures('five_hour', fiveHourResets, [[last, 100]]), ...measures('week', weekResets, [[last, 62]])]
      : [
          ...measures('five_hour', fiveHourResets, [
            [new Date(now - 3 * HOUR), 70],
            [last, 100],
          ]),
          ...measures('week', weekResets, [
            [new Date(now - 6 * HOUR), 58],
            [last, 62],
          ]),
        ],
  });
  const day = dayIn(new Date(now), 'Europe/Paris');
  await ctx.prisma.unscoped.fxRate.upsert({
    where: { day: dateOf(day) },
    create: { day: dateOf(day), usdPerEur: new Prisma.Decimal(USD_PER_EUR), fetchedAt: new Date(now) },
    update: { usdPerEur: new Prisma.Decimal(USD_PER_EUR) },
  });
  await ctx.prisma.unscoped.spend.create({
    data: {
      id: newId(),
      pilotId,
      engine: 'codex',
      day: dateOf(day),
      costUsdMicros: CODEX_MONTH_USD_MICROS,
      costEurCents: CODEX_MONTH_EUR_CENTS,
      measuredAt: lastMeasureAt ?? new Date(now - 30 * MINUTE),
    },
  });
};
