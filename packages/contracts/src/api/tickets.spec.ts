import {
  eventPayloadSchema,
  STATE_SLICES,
  TICKETS_PAGE,
  zCodeChange,
  zCodeChangeCheck,
  zMilestone,
  zTicket,
  zTicketDetail,
  zTicketListQuery,
  zTicketNumber,
} from '../index.js';

const bytes = (n: number) => Buffer.alloc(n, 7).toString('base64url');
const SEALED = { key: bytes(60), ciphertext: bytes(32) };
const PROJECT = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a02';
const SHA = 'a'.repeat(40);

const TICKET = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a10',
  projectId: PROJECT,
  source: 'github',
  number: 42,
  title: 'Connexion GitHub',
  titleSealed: null,
  state: 'open',
  stateReason: null,
  closedAt: null,
  readyMark: true,
  ready: true,
  labels: ['ready-for-agent', 'priority:P1', 'size:S', 'type:fix'],
  labelsSealed: null,
  priority: 'P1',
  size: 'S',
  milestoneNumber: 3,
  blockedBy: [12],
  parentNumber: null,
  branchPrefix: 'fix',
  visualReview: false,
  sourceCreatedAt: '2026-11-10T08:00:00.000Z',
  sourceUpdatedAt: '2026-11-11T08:00:00.000Z',
  updatedAt: '2026-11-11T08:00:01.000Z',
};

const LOCAL_TICKET = { ...TICKET, source: 'local', title: null, titleSealed: SEALED, labels: ['ready-for-agent'], labelsSealed: SEALED };

const MILESTONE = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a11',
  projectId: PROJECT,
  source: 'github',
  number: 3,
  rank: 3,
  title: 'MVP',
  titleSealed: null,
  state: 'open',
  dueOn: '2026-12-01',
  openCount: 4,
  closedCount: 2,
  closedAt: null,
};

const CODE_CHANGE = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a12',
  projectId: PROJECT,
  source: 'github',
  number: 57,
  ticketNumber: 42,
  title: 'Connexion GitHub',
  titleSealed: null,
  state: 'open',
  headRef: 'feat/42-connexion-github',
  baseRef: 'develop',
  headSha: SHA,
  checks: 'pending',
  checksSha: SHA,
  mergedAt: null,
  mergedBy: null,
  mergeSha: null,
  sourceCreatedAt: '2026-11-11T09:00:00.000Z',
  updatedAt: '2026-11-11T09:00:01.000Z',
};

const CHECK = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a13',
  codeChangeId: CODE_CHANGE.id,
  sha: SHA,
  name: 'ci',
  state: 'running',
  durationMs: null,
  url: 'https://github.com/o/r/actions/runs/1',
};

describe('zTicket', () => {
  it('is a Ticket of GET /api/projects/:id/tickets, the payload of ticket.upserted and an item of the tickets slice', () => {
    expect(zTicket.parse(TICKET)).toEqual(TICKET);
    expect(eventPayloadSchema('ticket.upserted')?.parse(TICKET)).toEqual(TICKET);
    expect(eventPayloadSchema('ticket.removed')?.parse({ id: TICKET.id })).toEqual({ id: TICKET.id });
    expect(STATE_SLICES.tickets.parse([TICKET, LOCAL_TICKET])).toEqual([TICKET, LOCAL_TICKET]);
  });

  it('has a readable title on GitHub and a sealed one on Local, never both', () => {
    expect(zTicket.safeParse(LOCAL_TICKET).success).toBe(true);
    expect(zTicket.safeParse({ ...TICKET, titleSealed: SEALED }).success).toBe(false);
    expect(zTicket.safeParse({ ...TICKET, title: null, titleSealed: SEALED }).success).toBe(false);
    expect(zTicket.safeParse({ ...LOCAL_TICKET, title: 'Connexion' }).success).toBe(false);
    expect(zTicket.safeParse({ ...LOCAL_TICKET, titleSealed: null }).success).toBe(false);
  });

  it('keeps its figures to their values', () => {
    expect(zTicket.safeParse({ ...TICKET, priority: 'P3' }).success).toBe(false);
    expect(zTicket.safeParse({ ...TICKET, size: 'XXL' }).success).toBe(false);
    expect(zTicket.safeParse({ ...TICKET, branchPrefix: 'docs' }).success).toBe(false);
    expect(zTicket.safeParse({ ...TICKET, state: 'closed', stateReason: 'not_planned', closedAt: '2026-11-12T08:00:00.000Z' }).success).toBe(true);
    expect(zTicket.safeParse({ ...TICKET, stateReason: 'duplicate' }).success).toBe(false);
    expect(zTicket.safeParse({ ...TICKET, blockedBy: [0] }).success).toBe(false);
  });
});

describe('zMilestone', () => {
  it('is the payload of milestone.upserted and an item of the milestones slice, its rank readable beside a sealed title', () => {
    const local = { ...MILESTONE, source: 'local', title: null, titleSealed: SEALED, dueOn: null };
    expect(eventPayloadSchema('milestone.upserted')?.parse(MILESTONE)).toEqual(MILESTONE);
    expect(eventPayloadSchema('milestone.removed')?.parse({ id: MILESTONE.id })).toEqual({ id: MILESTONE.id });
    expect(STATE_SLICES.milestones.parse([MILESTONE, local])).toEqual([MILESTONE, local]);
    expect(zMilestone.safeParse({ ...local, title: 'MVP' }).success).toBe(false);
    expect(zMilestone.safeParse({ ...MILESTONE, dueOn: '2026-12-01T00:00:00Z' }).success).toBe(false);
  });
});

describe('zCodeChange', () => {
  it('is the payload of code-change.upserted and an item of the codeChanges slice', () => {
    expect(eventPayloadSchema('code-change.upserted')?.parse(CODE_CHANGE)).toEqual(CODE_CHANGE);
    expect(eventPayloadSchema('code-change.removed')?.parse({ id: CODE_CHANGE.id })).toEqual({ id: CODE_CHANGE.id });
    expect(STATE_SLICES.codeChanges.parse([CODE_CHANGE])).toEqual([CODE_CHANGE]);
  });

  it('is merged by the Boucle or the Pilote, its checks one of four states', () => {
    const merged = { ...CODE_CHANGE, state: 'merged', mergedAt: '2026-11-12T08:00:00.000Z', mergedBy: 'loop', mergeSha: 'b'.repeat(40) };
    expect(zCodeChange.safeParse(merged).success).toBe(true);
    expect(zCodeChange.safeParse({ ...merged, mergedBy: 'bot' }).success).toBe(false);
    expect(zCodeChange.safeParse({ ...CODE_CHANGE, checks: 'success' }).success).toBe(false);
    expect(zCodeChange.safeParse({ ...CODE_CHANGE, headSha: 'nope' }).success).toBe(false);
    expect(zCodeChange.safeParse({ ...CODE_CHANGE, title: null, titleSealed: SEALED }).success).toBe(false);
  });
});

describe('zTicketDetail', () => {
  it('is a Ticket with its changes of code and the checks of the latest one', () => {
    const detail = { ticket: TICKET, codeChanges: [CODE_CHANGE], checks: [CHECK] };
    expect(zTicketDetail.parse(detail)).toEqual(detail);
    expect(zCodeChangeCheck.safeParse({ ...CHECK, state: 'queued' }).success).toBe(false);
  });
});

describe('zTicketListQuery', () => {
  it('takes an optional state, open or closed, and a cursor', () => {
    expect(zTicketListQuery.parse({})).toEqual({});
    expect(zTicketListQuery.parse({ state: 'closed', cursor: 'abc' })).toEqual({ state: 'closed', cursor: 'abc' });
    expect(zTicketListQuery.safeParse({ state: 'ready' }).success).toBe(false);
    expect(TICKETS_PAGE).toBe(50);
  });

  it('reads a number of the path as a positive integer', () => {
    expect(zTicketNumber.parse('42')).toBe(42);
    expect(zTicketNumber.safeParse('0').success).toBe(false);
    expect(zTicketNumber.safeParse('4x').success).toBe(false);
  });
});
