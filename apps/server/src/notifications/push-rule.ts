import type { Decision } from '@crewdeck/contracts';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { TabPresence } from '../realtime/tab-presence.js';
import { PushDelivery } from './push-delivery.js';

/** How long the Pilote has had no Crewdeck tab visible before a Décision is pushed (US-18, ADR 0007). */
export const PUSH_AFTER_MS = 2 * 60_000;

/**
 * When a Décision is pushed (ATOI-4, ADR 0007, « Visibility and push »): the
 * Pilote with no tab visible for `PUSH_AFTER_MS` (or none at all) gets it at
 * once; otherwise it waits for their last visible tab to hide, then
 * `PUSH_AFTER_MS` more, and what still waits then is pushed together. A tab
 * visible again before that, and the Pilote has seen them: those are never
 * pushed.
 * Whether it is pushed at all (the account's and the Projet's setting), and
 * to which browsers, is `PushDelivery`'s.
 *
 * In memory, as the tabs: a restart loses the timers, the next Décision or
 * the next hide starts them again (one server process, ADR 0001).
 */
@Injectable()
export class PushRule implements OnModuleInit, OnModuleDestroy {
  /** Per Pilote, the Décisions raised while they were around, waiting for them to be away. */
  private readonly waiting = new Map<string, Set<string>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private removal: (() => void) | null = null;

  constructor(
    private readonly presence: TabPresence,
    private readonly delivery: PushDelivery,
  ) {}

  onModuleInit(): void {
    this.removal = this.presence.onChange((pilotId) => this.tabsChanged(pilotId));
  }

  onModuleDestroy(): void {
    this.removal?.();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.waiting.clear();
  }

  /** A Décision `created` for `pilotId`, once committed. */
  created(pilotId: string, decision: Decision): void {
    if (this.awayFor(pilotId) >= PUSH_AFTER_MS) {
      void this.delivery.now(pilotId, decision);
      return;
    }
    const ids = this.waiting.get(pilotId) ?? new Set<string>();
    this.waiting.set(pilotId, ids.add(decision.id));
    if (!this.presence.anyVisible(pilotId)) this.arm(pilotId);
  }

  /** How long `pilotId` has had no tab visible: none ever, forever. */
  private awayFor(pilotId: string): number {
    const now = new Date();
    const last = this.presence.lastVisibleAt(pilotId, now);
    return last ? now.getTime() - last.getTime() : Number.POSITIVE_INFINITY;
  }

  private tabsChanged(pilotId: string): void {
    if (this.presence.anyVisible(pilotId)) {
      if (this.cancel(pilotId)) this.waiting.delete(pilotId);
      return;
    }
    if (this.waiting.has(pilotId)) this.arm(pilotId);
  }

  /** Whether a timer of `pilotId`'s was running: the Pilote was away. */
  private cancel(pilotId: string): boolean {
    const timer = this.timers.get(pilotId);
    if (timer) clearTimeout(timer);
    return this.timers.delete(pilotId);
  }

  /** (Re)starts `pilotId`'s timer, for `PUSH_AFTER_MS` after their last visible tab. */
  private arm(pilotId: string): void {
    this.cancel(pilotId);
    const timer = setTimeout(() => this.fire(pilotId), Math.max(0, PUSH_AFTER_MS - this.awayFor(pilotId)));
    timer.unref();
    this.timers.set(pilotId, timer);
  }

  private fire(pilotId: string): void {
    this.timers.delete(pilotId);
    const ids = this.waiting.get(pilotId);
    if (this.presence.anyVisible(pilotId) || !ids) return;
    if (this.awayFor(pilotId) < PUSH_AFTER_MS) {
      this.arm(pilotId);
      return;
    }
    this.waiting.delete(pilotId);
    void this.delivery.waiting(pilotId, [...ids]);
  }
}
