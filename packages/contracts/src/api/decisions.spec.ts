import { DECISION_KINDS, eventPayloadSchema, STATE_SLICES, zDecision, zDecisionListQuery } from '../index.js';

const DECISION = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01',
  kind: 'ticket-blocked',
  projectId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a02',
  projectName: 'Crewdeck',
  subjectType: 'ticket',
  subjectId: '42',
  label: '#42 Connexion GitHub',
  metaParts: ['Code'],
  tone: 'halt',
  link: '/boucle?ticket=42',
  params: { number: 42, step: 'code', retried: false, session: null },
  state: 'open',
  outcome: null,
  createdAt: '2026-11-11T08:00:00.000Z',
  resolvedAt: null,
};

describe('zDecision', () => {
  it('is a Décision of GET /api/decisions, the payload of decision.upserted and an item of the decisions slice', () => {
    expect(zDecision.parse(DECISION)).toEqual(DECISION);
    expect(eventPayloadSchema('decision.upserted')?.parse(DECISION)).toEqual(DECISION);
    expect(eventPayloadSchema('decision.removed')?.parse({ id: DECISION.id })).toEqual({ id: DECISION.id });
    expect(STATE_SLICES.decisions.parse([DECISION])).toEqual([DECISION]);
  });

  it('has the fourteen kinds', () => {
    expect(DECISION_KINDS).toHaveLength(14);
    expect(zDecision.safeParse({ ...DECISION, kind: 'something-else' }).success).toBe(false);
  });

  it('may have no Projet', () => {
    expect(zDecision.safeParse({ ...DECISION, kind: 'runner-offline', projectId: null, projectName: null }).success).toBe(true);
  });

  it('bounds its label to 120 characters, its metaParts to 3 of at most 40', () => {
    expect(zDecision.safeParse({ ...DECISION, label: 'x'.repeat(121) }).success).toBe(false);
    expect(zDecision.safeParse({ ...DECISION, label: '' }).success).toBe(false);
    expect(zDecision.safeParse({ ...DECISION, metaParts: ['a', 'b', 'c', 'd'] }).success).toBe(false);
    expect(zDecision.safeParse({ ...DECISION, metaParts: ['x'.repeat(41)] }).success).toBe(false);
  });

  it('keeps params to flat values', () => {
    expect(zDecision.safeParse({ ...DECISION, params: { nested: { a: 1 } } }).success).toBe(false);
  });

  it('is accent, caution or halt, open or resolved', () => {
    expect(zDecision.safeParse({ ...DECISION, tone: 'go' }).success).toBe(false);
    expect(zDecision.safeParse({ ...DECISION, state: 'resolved', outcome: 'answered', resolvedAt: '2026-11-11T08:05:00.000Z' }).success).toBe(true);
    expect(zDecision.safeParse({ ...DECISION, state: 'pending' }).success).toBe(false);
  });
});

describe('zDecisionListQuery', () => {
  it('needs a state; a Projet and a cursor are optional', () => {
    expect(zDecisionListQuery.safeParse({}).success).toBe(false);
    expect(zDecisionListQuery.parse({ state: 'open' })).toEqual({ state: 'open' });
    expect(zDecisionListQuery.parse({ state: 'resolved', projectId: DECISION.projectId, cursor: 'abc' })).toEqual({
      state: 'resolved',
      projectId: DECISION.projectId,
      cursor: 'abc',
    });
    expect(zDecisionListQuery.safeParse({ state: 'resolved', projectId: 'nope' }).success).toBe(false);
  });
});
