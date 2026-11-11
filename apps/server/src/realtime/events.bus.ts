import type { Event } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

export type EventListener = (event: Event) => void;

/**
 * The fan-out of the committed events, in memory, per Pilote: one server
 * process at the MVP (ADR 0001), no `LISTEN/NOTIFY`. A listener that throws
 * is logged and skipped: the others still get the event.
 */
@Injectable()
export class EventsBus {
  private readonly listeners = new Map<string, Set<EventListener>>();

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

  /** Hands `event` to every listener of `pilotId`, and to no other Pilote's. */
  publish(pilotId: string, event: Event): void {
    for (const listener of [...(this.listeners.get(pilotId) ?? [])]) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error({ err: error, seq: event.seq, type: event.type }, 'an event listener failed');
      }
    }
  }
}
