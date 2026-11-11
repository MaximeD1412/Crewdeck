import { z } from 'zod';
import { DEFAULT_ACCOUNT_SETTINGS, withSeq, zClientMessage, zServerMessage, zState, STATE_SLICES } from '../index.js';

const PILOT = { id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a7b', login: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris' };

describe('zClientMessage', () => {
  it('accepts hello with a seq or null, ping, visibility', () => {
    for (const message of [{ type: 'hello', lastSeq: 12 }, { type: 'hello', lastSeq: null }, { type: 'ping' }, { type: 'visibility', visible: false }]) {
      expect(zClientMessage.parse(message)).toEqual(message);
    }
  });

  it('reads the lastSeq the page sends as a decimal string', () => {
    expect(zClientMessage.parse({ type: 'hello', lastSeq: '12' })).toEqual({ type: 'hello', lastSeq: 12 });
  });

  it('rejects a hello without lastSeq, a visibility without visible, an unknown type', () => {
    for (const message of [{ type: 'hello' }, { type: 'visibility' }, { type: 'event' }, {}]) {
      expect(zClientMessage.safeParse(message).success, JSON.stringify(message)).toBe(false);
    }
  });
});

describe('zServerMessage', () => {
  it('accepts an event, snapshot-required, live, pong', () => {
    const event = { type: 'event', event: { seq: 1, type: 'pilot.upserted', payload: PILOT, at: '2026-11-11T08:00:00.000Z' } };
    for (const message of [event, { type: 'snapshot-required' }, { type: 'live' }, { type: 'pong' }]) {
      expect(zServerMessage.parse(message)).toEqual(message);
    }
  });

  it('rejects an event whose payload does not match its type', () => {
    const event = { type: 'event', event: { seq: 1, type: 'pilot.upserted', payload: {}, at: '2026-11-11T08:00:00.000Z' } };
    expect(zServerMessage.safeParse(event).success).toBe(false);
  });
});

describe('withSeq', () => {
  it('adds the seq the page last applied to a command body', () => {
    const schema = withSeq(z.object({ title: z.string() }));
    expect(schema.parse({ title: 'x', seq: 4 })).toEqual({ title: 'x', seq: 4 });
    expect(schema.parse({ title: 'x', seq: '4' })).toEqual({ title: 'x', seq: 4 });
    expect(schema.safeParse({ title: 'x' }).success).toBe(false);
  });
});

describe('zState', () => {
  it('is the seq it reflects and one slice per registered key', () => {
    const settings = { ...DEFAULT_ACCOUNT_SETTINGS, timeZone: 'Europe/Paris' };
    expect(Object.keys(STATE_SLICES)).toEqual(['pilot', 'runner', 'settings']);
    expect(zState.parse({ seq: 3, pilot: PILOT, runner: null, settings })).toEqual({ seq: 3, pilot: PILOT, runner: null, settings });
    expect(zState.safeParse({ seq: 3, pilot: PILOT }).success).toBe(false);
    expect(zState.safeParse({ seq: 3, runner: null }).success).toBe(false);
  });
});
