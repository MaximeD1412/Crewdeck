import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { RunnerLinks } from './runner-links.service.js';

/** How often the codes past their 10 minutes are looked for. */
export const LINK_SWEEP_EVERY_MS = 30_000;

/**
 * Every 30 s, the live codes past their 10 minutes expire, each with its
 * `runner-link.upserted`: the page shows « Code de liaison expiré » without
 * asking. A route that reads a code past its time expires it first, so the
 * sweep's delay is never seen by the binary.
 */
@Injectable()
export class RunnerLinkSweep {
  constructor(
    private readonly links: RunnerLinks,
    @InjectPinoLogger(RunnerLinkSweep.name) private readonly logger: PinoLogger,
  ) {}

  @Interval('runner-link-sweep', LINK_SWEEP_EVERY_MS)
  async run(): Promise<void> {
    try {
      await this.links.expireDue();
    } catch (error) {
      this.logger.error({ err: error }, 'runner link sweep failed');
    }
  }
}
