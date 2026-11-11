import type { Event } from '@crewdeck/contracts';
import { PublicationOrder } from './publication-order.js';

const event = (seq: number): Event => ({ seq, type: 'pilot.upserted', payload: {}, at: '2026-11-11T08:00:00.000Z' });

describe('PublicationOrder', () => {
  const setUp = () => {
    const published: string[] = [];
    const order = new PublicationOrder((pilotId, e) => published.push(`${pilotId}:${e.seq}`));
    return { order, published };
  };

  it('holds a settled place until every place before it is settled, and drops a rolled-back one', () => {
    const { order, published } = setUp();
    const first = order.reserve('alice');
    const rolledBack = order.reserve('alice');
    const third = order.reserve('alice');
    first.events.push(event(1));
    // Its seq was released by the rollback, and taken again by the next transaction.
    rolledBack.events.push(event(2));
    third.events.push(event(2));

    order.settle('alice', third, true);
    order.settle('alice', rolledBack, false);
    expect(published).toEqual([]);
    order.settle('alice', first, true);

    expect(published).toEqual(['alice:1', 'alice:2']);
  });

  it('never holds a Pilote’s events behind another Pilote’s', () => {
    const { order, published } = setUp();
    const alice = order.reserve('alice');
    const bob = order.reserve('bob');
    bob.events.push(event(1));

    order.settle('bob', bob, true);

    expect(published).toEqual(['bob:1']);
    order.settle('alice', alice, true);
  });
});
