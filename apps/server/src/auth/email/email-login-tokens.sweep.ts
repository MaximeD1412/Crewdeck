import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { EmailLinks } from './email-links.js';

/** How long a link's row is kept: well past its 15 minutes and the per-address hour. */
export const EMAIL_LOGIN_TOKENS_KEPT_MS = 24 * 60 * 60 * 1000;

const EVERY_HOUR_MS = 60 * 60 * 1000;

/** Every hour, the links drawn more than 24 hours ago are deleted, used or not. */
@Injectable()
export class EmailLoginTokensSweep {
  constructor(
    private readonly links: EmailLinks,
    @InjectPinoLogger(EmailLoginTokensSweep.name) private readonly logger: PinoLogger,
  ) {}

  @Interval('email-login-tokens-sweep', EVERY_HOUR_MS)
  async run(): Promise<void> {
    try {
      await this.links.sweep(EMAIL_LOGIN_TOKENS_KEPT_MS);
    } catch (error) {
      this.logger.error({ err: error }, 'email login tokens sweep failed');
    }
  }
}
