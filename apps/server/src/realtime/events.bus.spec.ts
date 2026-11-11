import type { Event } from '@crewdeck/contracts';
import type { PinoLogger } from 'nestjs-pino';
import { EventsBus } from './events.bus.js';

const event = (seq: number): Event => ({ seq, type: 'pilot.upserted', payload: {}, at: '2026-11-11T08:00:00.000Z' });

describe('EventsBus', () => {
  const logger = { error: vi.fn() };
  const bus = (): EventsBus => new EventsBus(logger as unknown as PinoLogger);

  it('hands an event to every listener of its Pilote, and to no other Pilote’s', () => {
    const events = bus();
    const alice: number[] = [];
    const bob: number[] = [];
    events.subscribe('alice', (e) => alice.push(e.seq));
    events.subscribe('alice', (e) => alice.push(e.seq * 10));
    events.subscribe('bob', (e) => bob.push(e.seq));

    events.publish('alice', event(1));

    expect(alice).toEqual([1, 10]);
    expect(bob).toEqual([]);
  });

  it('stops calling a listener once unsubscribed', () => {
    const events = bus();
    const seen: number[] = [];
    const unsubscribe = events.subscribe('alice', (e) => seen.push(e.seq));

    events.publish('alice', event(1));
    unsubscribe();
    events.publish('alice', event(2));

    expect(seen).toEqual([1]);
  });

  it('logs a listener that throws and still calls the others', () => {
    const events = bus();
    const seen: number[] = [];
    events.subscribe('alice', () => {
      throw new Error('socket gone');
    });
    events.subscribe('alice', (e) => seen.push(e.seq));

    events.publish('alice', event(3));

    expect(seen).toEqual([3]);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ seq: 3, type: 'pilot.upserted' }), 'an event listener failed');
  });
});
