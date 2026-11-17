import { eventPayloadSchema, STATE_SLICES, zAgentSession, zAgentSessionList, zAgentSessionListQuery, zSessionAction } from '../index.js';

const SESSION = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a91',
  projectId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a92',
  role: 'code',
  engine: 'claude-code',
  model: 'claude-opus-5-5',
  title: 'Le panier garde les articles',
  state: 'interrupted',
  interruptedReason: 'runner-offline',
  outcome: null,
  error: null,
  stepRunId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a93',
  branch: 'feat/12-panier',
  startedAt: '2026-11-11T09:00:00.000Z',
  endedAt: null,
};

describe('zAgentSession', () => {
  it('is a Session of GET /api/sessions, the payload of agent-session.upserted and an item of the sessions slice', () => {
    expect(zAgentSession.parse(SESSION)).toEqual(SESSION);
    expect(eventPayloadSchema('agent-session.upserted')?.parse(SESSION)).toEqual(SESSION);
    expect(STATE_SLICES.sessions.parse([SESSION])).toEqual([SESSION]);
    expect(zAgentSessionList.parse({ items: [SESSION], nextCursor: null })).toEqual({ items: [SESSION], nextCursor: null });
  });

  it('ends ok or in error, by a code only', () => {
    const ended = { ...SESSION, state: 'ended', interruptedReason: null, outcome: 'error', error: 'setup-failed', endedAt: '2026-11-11T09:05:00.000Z' };
    expect(zAgentSession.parse(ended)).toEqual(ended);
    expect(zAgentSession.safeParse({ ...ended, error: 'it broke' }).success).toBe(false);
    expect(zAgentSession.safeParse({ ...SESSION, interruptedReason: 'pilot' }).success).toBe(false);
  });

  it('may run no StepRun, and play a Rôle the Pilote added', () => {
    expect(zAgentSession.safeParse({ ...SESSION, stepRunId: null, role: 'r-a1b2c3d4' }).success).toBe(true);
  });

  it('lists by Projet and cursor, and stops or resumes with the seq read', () => {
    expect(zAgentSessionListQuery.parse({ projectId: SESSION.projectId })).toEqual({ projectId: SESSION.projectId });
    expect(zAgentSessionListQuery.safeParse({ projectId: 'shop' }).success).toBe(false);
    expect(zSessionAction.parse({ seq: '12' })).toEqual({ seq: 12 });
    expect(zSessionAction.safeParse({}).success).toBe(false);
  });
});
