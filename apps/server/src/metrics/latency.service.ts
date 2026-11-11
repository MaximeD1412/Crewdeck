import { LATENCY_MAX_DELAY_MS, type LatencySample } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { newId } from '../ids.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ScopeViolationError } from '../scope/prisma-scope.extension.js';
import { currentPilotId } from '../scope/scope.context.js';
import { latencyP95 } from './latency.sql.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The p95 of a period, `null` without any sample, and how many samples it is over. */
export interface LatencyP95 {
  readonly p95Ms: number | null;
  readonly count: number;
}

/**
 * The latency the Pilote's pages measured (US-20, ADR 0007): from the time a
 * source saw a change to the screen showing it. The samples are not events:
 * written as they come, read by the statistics (PILOTAGE-3).
 */
@Injectable()
export class LatencyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes the samples of the current scope's Pilote, but those over
   * `LATENCY_MAX_DELAY_MS`: a clock off, dropped rather than corrected.
   * Returns how many were written.
   */
  async record(samples: readonly LatencySample[]): Promise<number> {
    const kept = samples.filter((sample) => sample.delayMs <= LATENCY_MAX_DELAY_MS);
    if (kept.length === 0) return 0;
    const pilotId = currentPilotId();
    const { count } = await this.prisma.scoped.latencySample.createMany({
      data: kept.map(({ source, delayMs, at }) => ({ id: newId(), pilotId, source, delayMs, at: new Date(at) })),
    });
    return count;
  }

  /**
   * The p95 of `pilotId`'s samples of the last `days` (PostgreSQL's
   * `percentile_cont(0.95)`), in the scope of that Pilote: another one's
   * throws `ScopeViolationError`.
   */
  p95(pilotId: string, { days }: { days: number }, now = new Date()): Promise<LatencyP95> {
    if (currentPilotId() !== pilotId) throw new ScopeViolationError('LatencySample', 'p95', `${pilotId} is not the scope's Pilote`);
    return latencyP95(this.prisma, pilotId, new Date(now.getTime() - days * DAY_MS));
  }
}
