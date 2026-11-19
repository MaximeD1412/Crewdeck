import type { Event } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

export type EventListener = (event: Event) => void;
/** A listener of every Pilote's events: a module that reacts to them server-side (the readiness of the Projets, PROJET-3). */
export type AllEventsListener = (pilotId: string, event: Event) => void;

/**
 * The fan-out of the committed events, in memory, per Pilote: one server
 * process at the MVP (ADR 0001), no `LISTEN/NOTIFY`. A listener that throws
 * is logged and skipped: the others still get the event.
 */
@Injectable()
export class EventsBus {
  private readonly listeners = new Map<string, Set<EventListener>>();
  private readonly allListeners = new Set<AllEventsListener>();

  constructor(@InjectPinoLogger(EventsBus.name) private readonly logger: PinoLogger) {}

  /** Calls `listener` with every event of `pilotId` published from now on; returns its unsubscription. */
  subscribe(pilotId: string, listener: EventListener): () => void {
    const listeners = this.listeners.get(pilotId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(pilotId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && this.listeners.get(pilotId) === listeners) this.listeners.delete(pilotId);
    };
  }

  /** Calls `listener` with every event of every Pilote published from now on, and its Pilote; returns its unsubscription. */
  subscribeAll(listener: AllEventsListener): () => void {
    this.allListeners.add(listener);
    return () => this.allListeners.delete(listener);
  }

  /** Hands `event` to every listener of `pilotId`, and to no other Pilote's; then to the listeners of all. */
  publish(pilotId: string, event: Event): void {
    const listeners: EventListener[] = [...(this.listeners.get(pilotId) ?? []), ...[...this.allListeners].map((listener) => (e: Event) => listener(pilotId, e))];
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error({ err: error, seq: event.seq, type: event.type }, 'an event listener failed');
      }
    }
  }
}
