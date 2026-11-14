import { EMAIL_LINKS_PER_ADDRESS_PER_HOUR, EMAIL_LINKS_PER_IP_PER_HOUR } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import { MESSAGES } from '../../errors/messages.js';

const HOUR_MS = 60 * 60 * 1000;

const tooMany = (): AppError => new AppError(429, 'auth.too-many-requests', MESSAGES['auth.too-many-requests']);

/**
 * The limits of the sign-in links (risk SEC-12): 20 per IP per sliding hour,
 * in this process's memory as `RunnerLinkLimiter` (one server process at the
 * MVP); 5 per address per hour, counted in `email_login_tokens`, so a restart
 * forgets none. Past either, 429 `auth.too-many-requests`.
 */
@Injectable()
export class EmailLinkLimiter {
  private readonly requests = new Map<string, number[]>();
  /** The time the limits read: a test moves it. */
  now: () => number = () => Date.now();

  /** Counts a request of `ip`; throws 429 once it made 20 within the last hour. */
  hitIp(ip: string): void {
    const now = this.now();
    const recent = (this.requests.get(ip) ?? []).filter((at) => at > now - HOUR_MS);
    if (recent.length >= EMAIL_LINKS_PER_IP_PER_HOUR) {
      this.requests.set(ip, recent);
      throw tooMany();
    }
    recent.push(now);
    this.requests.set(ip, recent);
    if (this.requests.size > 10_000) this.prune(now);
  }

  /**
   * Throws 429 when `email` has 5 links drawn within the last hour. Run in
   * the transaction that draws the next, after the address's advisory lock: two requests
   * at once cannot both see 4.
   */
  async checkAddress(tx: Pick<Prisma.TransactionClient, 'emailLoginToken'>, email: string): Promise<void> {
    const since = new Date(this.now() - HOUR_MS);
    const drawn = await tx.emailLoginToken.count({ where: { email, createdAt: { gt: since } } });
    if (drawn >= EMAIL_LINKS_PER_ADDRESS_PER_HOUR) throw tooMany();
  }

  /** Forgets every IP (the tests, the scenarios). */
  reset(): void {
    this.requests.clear();
  }

  private prune(now: number): void {
    for (const [ip, times] of this.requests) if (!times.some((at) => at > now - HOUR_MS)) this.requests.delete(ip);
  }
}
