import type { Tx } from '../realtime/transactions.js';
import type { EventsWriter } from '../realtime/events.writer.js';
import { runInPilotScope } from '../scope/scope.context.js';
import { decodeDecisionCursor, encodeDecisionCursor } from './decision-cursor.js';
import { DecisionInputError, DecisionsService, type RaiseInput } from './decisions.service.js';

const PILOT = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a00';

const INPUT: RaiseInput = {
  kind: 'ticket-blocked',
  projectId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a02',
  projectName: 'Crewdeck',
  subjectType: 'ticket',
  subjectId: '42',
  label: '#42 Connexion GitHub',
  metaParts: ['Code'],
  tone: 'halt',
  link: '/boucle?ticket=42',
  params: { number: 42 },
};

const ROW = {
  ...INPUT,
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01',
  state: 'open' as const,
  outcome: null,
  createdAt: new Date('2026-11-11T08:00:00.000Z'),
  resolvedAt: null,
};

/** A transaction that answers `findFirst` with `found` and fails on anything else. */
const txFinding = (found: unknown): Tx => ({ decision: { findFirst: () => Promise.resolve(found) } }) as unknown as Tx;
const service = () => new DecisionsService({ write: () => Promise.reject(new Error('no event expected')) } as unknown as EventsWriter);

describe('the cursor of the resolved Décisions', () => {
  it('comes back as the createdAt and id it was made of', () => {
    const cursor = encodeDecisionCursor({ createdAt: ROW.createdAt, id: ROW.id });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeDecisionCursor(cursor)).toEqual({ createdAt: ROW.createdAt, id: ROW.id });
  });

  it('is refused when it was not made by the list', () => {
    const encode = (text: string) => Buffer.from(text).toString('base64url');
    expect(decodeDecisionCursor('abc')).toBeUndefined();
    expect(decodeDecisionCursor(encode(`yesterday|${ROW.id}`))).toBeUndefined();
    expect(decodeDecisionCursor(encode('2026-11-11T08:00:00.000Z|42'))).toBeUndefined();
    expect(decodeDecisionCursor(encode(`2026-11-11T08:00:00.000Z|${ROW.id}|more`))).toBeUndefined();
  });
});

describe('DecisionsService.raise', () => {
  it.each([
    ['an unknown kind', { kind: 'something-else' }],
    ['a label over 120 characters', { label: 'x'.repeat(121) }],
    ['four metaParts', { metaParts: ['a', 'b', 'c', 'd'] }],
    ['a nested param', { params: { nested: { a: 1 } } }],
    ['a link that is not a page', { link: 'https://example.test/boucle' }],
  ])('refuses %s before writing anything', async (_case, change) => {
    await expect(runInPilotScope(PILOT, () => service().raise(txFinding(null), { ...INPUT, ...change } as RaiseInput))).rejects.toThrow(
      DecisionInputError,
    );
  });
});

describe('DecisionsService.assertOpen', () => {
  it('gives the open Décision', async () => {
    await expect(service().assertOpen(txFinding(ROW), ROW.id)).resolves.toMatchObject({ id: ROW.id, state: 'open' });
  });

  it('answers 409 decision.already-answered once it was resolved', async () => {
    const resolved = { ...ROW, state: 'resolved', outcome: 'answered', resolvedAt: new Date() };
    await expect(service().assertOpen(txFinding(resolved), ROW.id)).rejects.toMatchObject({
      status: 409,
      code: 'decision.already-answered',
      message: 'Cette Décision a déjà été prise.',
    });
  });

  it('answers 404 decision.not-found when the scope does not see it', async () => {
    await expect(service().assertOpen(txFinding(null), ROW.id)).rejects.toMatchObject({ status: 404, code: 'decision.not-found' });
  });
});
