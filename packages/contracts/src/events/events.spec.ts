import { z } from 'zod';
import { eventPayloadSchema, registerEventPayload, zEvent, zEventType } from '../index.js';

const PILOT = { id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a7b', login: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done' };
const AT = '2026-11-11T08:00:00.000Z';

describe('zEventType', () => {
  it('is `<resource>.upserted` or `<resource>.removed` for every resource of ADR 0007', () => {
    for (const type of ['pilot.upserted', 'ai-account.removed', 'agent-session.upserted', 'step-run.removed', 'usage.upserted']) {
      expect(zEventType.parse(type)).toBe(type);
    }
  });

  it('rejects an unknown resource or verb', () => {
    for (const type of ['pilots.upserted', 'pilot.created', 'pilot', '.upserted']) expect(zEventType.safeParse(type).success, type).toBe(false);
  });
});

describe('the event payloads', () => {
  it('gives the pilot payload the shape of GET /api/me', () => {
    expect(eventPayloadSchema('pilot.upserted')?.parse(PILOT)).toEqual(PILOT);
    expect(eventPayloadSchema('pilot.upserted')?.safeParse({ ...PILOT, login: '' }).success).toBe(false);
  });

  it('gives every removed event the id of what was removed', () => {
    expect(eventPayloadSchema('idea.removed')?.parse({ id: PILOT.id })).toEqual({ id: PILOT.id });
    expect(eventPayloadSchema('idea.removed')?.safeParse({ id: 'i1' }).success).toBe(false);
  });

  it('has no payload for a resource whose module has not registered one', () => {
    expect(eventPayloadSchema('usage.upserted')).toBeUndefined();
  });

  it('refuses a second schema for the same resource', () => {
    expect(() => registerEventPayload('pilot', z.object({ id: z.string() }))).toThrow(/pilot/);
  });
});

describe('zEvent', () => {
  const event = { seq: 7, type: 'pilot.upserted', payload: PILOT, at: AT };

  it('accepts an event whose payload matches its type, with or without sourceAt', () => {
    expect(zEvent.parse(event)).toEqual(event);
    expect(zEvent.parse({ ...event, sourceAt: AT })).toMatchObject({ sourceAt: AT });
  });

  it('rejects a payload that does not match its type, an unregistered type, a negative seq', () => {
    expect(zEvent.safeParse({ ...event, payload: { id: PILOT.id } }).success).toBe(false);
    expect(zEvent.safeParse({ ...event, type: 'usage.upserted' }).success).toBe(false);
    expect(zEvent.safeParse({ ...event, seq: -1 }).success).toBe(false);
  });
});
