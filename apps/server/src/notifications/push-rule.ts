import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { TabPresence } from '../realtime/tab-presence.js';
import { PushDelivery } from './push-delivery.js';

/** How long the Pilote has had no Crewdeck tab visible before a Décision is pushed (US-18, ADR 0007). */
export const PUSH_AFTER_MS = 2 * 60_000;
/** How long after a push that reached no browser (its push service failing) it is tried again… */
export const PUSH_RETRY_MS = 5 * 60_000;
/** …and how many times, before what waits is left for the next Décision or the Pilote's return. */
export const PUSH_RETRIES = 3;

/**
 * When a Décision is pushed (ATOI-4, ADR 0007, « Visibility and push »): the
 * Pilote with no tab visible for `PUSH_AFTER_MS` (or none at all) gets it at
 * once; otherwise it waits for their last visible tab to hide, then
 * `PUSH_AFTER_MS` more, and what still waits then is pushed together. A tab
 * visible again before that, and the Pilote has seen them: those are never
 * pushed (`PushDelivery.seen`).
 * What waits, whether it is pushed at all (the account's and the Projet's
 * setting), and to which browsers, are `PushDelivery`'s, in the database.
 *
 * The timers are in memory, as the tabs (one server process, ADR 0001): after
 * a restart, a tab back that says it is hidden, or the next Décision, pushes
 * what waited; a tab back visible has seen it. A tab that has not said its
 * visibility yet is waited for before a timer starts: it may be the Pilote's,
 * reconnecting.
 */
@Injectable()
export class PushRule implements OnModuleInit, OnModuleDestroy {
  /** The Pilotes with a tab visible at the last change of their tabs. */
  private readonly around = new Set<string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Per Pilote, the tries again of the push that last reached no browser. */
  private readonly retries = new Map<string, number>();
  private removal: (() => void) | null = null;
  private stopped = false;

  constructor(
    private readonly presence: TabPresence,
    private readonly delivery: PushDelivery,
  ) {}

  onModuleInit(): void {
    this.removal = this.presence.onChange((pilotId) => this.tabsChanged(pilotId));
  }

  onModuleDestroy(): void {
    this.stopped = true;
    this.removal?.();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.retries.clear();
    this.around.clear();
  }

  /** A Décision created for `pilotId`, once committed. */
  created(pilotId: string): void {
    if (this.awayFor(pilotId) >= PUSH_AFTER_MS) void this.push(pilotId);
    else if (!this.presence.anyVisible(pilotId) && !this.timers.has(pilotId)) this.arm(pilotId);
  }

  /** How long `pilotId` has had no tab visible: none ever, forever. */
  private awayFor(pilotId: string): number {
    const now = new Date();
    const last = this.presence.lastVisibleAt(pilotId, now);
    return last ? now.getTime() - last.getTime() : Number.POSITIVE_INFINITY;
  }

  private tabsChanged(pilotId: string): void {
    if (this.presence.anyVisible(pilotId)) {
      if (this.around.has(pilotId)) return;
      this.around.add(pilotId);
      this.cancel(pilotId);
      this.retries.delete(pilotId);
      void this.delivery.seen(pilotId, new Date());
      return;
    }
    this.around.delete(pilotId);
    if (this.presence.tabsOf(pilotId).some(({ visible }) => visible === null)) return;
    if (!this.timers.has(pilotId)) this.arm(pilotId);
  }

  private cancel(pilotId: string): void {
    clearTimeout(this.timers.get(pilotId));
    this.timers.delete(pilotId);
  }

  /** (Re)starts `pilotId`'s timer: `PUSH_AFTER_MS` after their last visible tab by default. */
  private arm(pilotId: string, delay = Math.max(0, PUSH_AFTER_MS - this.awayFor(pilotId))): void {
    this.cancel(pilotId);
    const timer = setTimeout(() => this.fire(pilotId), delay);
    timer.unref();
    this.timers.set(pilotId, timer);
  }

  private fire(pilotId: string): void {
    this.timers.delete(pilotId);
    if (this.presence.anyVisible(pilotId)) return;
    if (this.awayFor(pilotId) < PUSH_AFTER_MS) this.arm(pilotId);
    else void this.push(pilotId);
  }

  private async push(pilotId: string): Promise<void> {
    const result = await this.delivery.push(pilotId);
    if (this.stopped) return;
    const tries = this.retries.get(pilotId) ?? 0;
    if (result === 'done' || tries >= PUSH_RETRIES || this.presence.anyVisible(pilotId)) {
      this.retries.delete(pilotId);
      return;
    }
    this.retries.set(pilotId, tries + 1);
    if (!this.timers.has(pilotId)) this.arm(pilotId, PUSH_RETRY_MS);
  }
}
