import type { Event } from '@crewdeck/contracts';

/** The place of one transaction's events of one Pilote in the order they are published in. */
export interface Place {
  readonly events: Event[];
  settled: 'open' | 'committed' | 'rolled-back';
}

/**
 * Publishes each Pilote's events in the order of their `seq`, whatever the
 * order their transactions return in. A transaction takes its place when its
 * first event of the Pilote gets its `seq` (`reserve`): the Pilote's row is
 * then locked until it commits, so the places are taken in the order of the
 * `seq`s. A settled place is published (or dropped, rolled back) only once
 * every place before it is settled: a commit that returns late holds the
 * later ones, never long, as each transaction is settled when it ends.
 */
export class PublicationOrder {
  private readonly queues = new Map<string, Place[]>();

  constructor(private readonly publish: (pilotId: string, event: Event) => void) {}

  reserve(pilotId: string): Place {
    const place: Place = { events: [], settled: 'open' };
    const queue = this.queues.get(pilotId) ?? [];
    queue.push(place);
    this.queues.set(pilotId, queue);
    return place;
  }

  settle(pilotId: string, place: Place, committed: boolean): void {
    place.settled = committed ? 'committed' : 'rolled-back';
    const queue = this.queues.get(pilotId);
    if (!queue) return;
    while (queue[0] && queue[0].settled !== 'open') {
      const head = queue.shift() as Place;
      if (head.settled === 'committed') for (const event of head.events) this.publish(pilotId, event);
    }
    if (queue.length === 0) this.queues.delete(pilotId);
  }
}
