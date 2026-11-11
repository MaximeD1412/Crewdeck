import { LINK_ATTEMPTS_PER_MINUTE } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { AppError } from '../../errors/app-error.js';
import { MESSAGES } from '../../errors/messages.js';
import { RunnerClock } from '../clock.js';

const WINDOW_MS = 60_000;

/**
 * The attempts of `POST /api/runner/link` and `POST /api/runner/link-failures`
 * by IP (ADR 0003): 10 per sliding minute, then 429 `runner.link-rate-limited`.
 * A short id has about a million values: this keeps a guess from finding a
 * live one. In the memory of this server process.
 */
@Injectable()
export class RunnerLinkLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(private readonly clock: RunnerClock) {}

  /** Counts an attempt of `ip`; throws 429 once it made 10 within the last minute. */
  hit(ip: string): void {
    const now = this.clock.now().getTime();
    const recent = (this.attempts.get(ip) ?? []).filter((at) => at > now - WINDOW_MS);
    if (recent.length >= LINK_ATTEMPTS_PER_MINUTE) {
      this.attempts.set(ip, recent);
      throw new AppError(429, 'runner.link-rate-limited', MESSAGES['runner.link-rate-limited']);
    }
    recent.push(now);
    this.attempts.set(ip, recent);
    if (this.attempts.size > 10_000) this.prune(now);
  }

  /** Forgets every IP (the tests). */
  reset(): void {
    this.attempts.clear();
  }

  private prune(now: number): void {
    for (const [ip, times] of this.attempts) if (!times.some((at) => at > now - WINDOW_MS)) this.attempts.delete(ip);
  }
}
