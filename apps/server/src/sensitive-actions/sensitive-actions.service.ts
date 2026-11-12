import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { conflict } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';

/** What one request to an Action sensible records: whether its handler checked the freshness. */
export interface FreshnessCheck {
  checked: boolean;
}

/**
 * The freshness check of an Action sensible (CORE-7): the Pilote confirmed on
 * a state whose `seq` the command carries; a later change of the resource
 * (its `lastSeq`) means they agreed to something else.
 */
@Injectable()
export class SensitiveActionsService {
  private readonly checks = new AsyncLocalStorage<FreshnessCheck>();

  /**
   * 409 `sensitive-action.stale` when the resource changed after the `seq`
   * the Pilote confirmed on; marks the request as checked either way.
   */
  assertFresh(lastSeq: bigint, commandSeq: bigint): void {
    const check = this.checks.getStore();
    if (check) check.checked = true;
    if (commandSeq < lastSeq) throw conflict('sensitive-action.stale', MESSAGES['sensitive-action.stale']);
  }

  /** Runs `fn` with a record of its request's check: the interceptor reads it once the handler answered. */
  track<T>(check: FreshnessCheck, fn: () => T): T {
    return this.checks.run(check, fn);
  }
}
