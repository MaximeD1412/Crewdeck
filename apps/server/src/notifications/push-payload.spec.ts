import { DECISION_KINDS, type Decision, zPushPayload } from '@crewdeck/contracts';
import { KIND_LABELS, pushPayloadOf } from './push-payload.js';

const decision = (id: string, change: Partial<Decision> = {}): Decision => ({
  id,
  kind: 'ticket-blocked',
  projectId: null,
  projectName: null,
  subjectType: 'ticket',
  subjectId: id,
  label: '#44 attend ta réponse',
  metaParts: [],
  tone: 'halt',
  link: '/tickets/44',
  params: {},
  state: 'open',
  outcome: null,
  createdAt: '2026-11-16T10:00:00.000Z',
  resolvedAt: null,
  ...change,
});

const A = decision('019a6b2c-0000-7000-8000-00000000000a');
const B = decision('019a6b2c-0000-7000-8000-00000000000b');

describe('pushPayloadOf', () => {
  it('titles one Décision with its kind and its label, opening its link, tagged with its id', () => {
    expect(pushPayloadOf([A])).toEqual({ title: 'Ticket bloqué · #44 attend ta réponse', url: '/tickets/44', tag: A.id });
  });

  it('titles Idées with « Idées à trier » only', () => {
    const ideas = decision('019a6b2c-0000-7000-8000-00000000000c', { kind: 'ideas-to-triage', label: '3 Idées', link: '/idees' });
    expect(pushPayloadOf([ideas])).toEqual({ title: 'Idées à trier', url: '/idees', tag: ideas.id });
  });

  it('counts several Décisions, opening « À toi »', () => {
    expect(pushPayloadOf([A, B])).toEqual({ title: '2 Décisions t’attendent', url: '/a-toi', tag: 'decisions' });
  });

  it('gives a payload of the contracts, a label to every kind', () => {
    for (const kind of DECISION_KINDS) expect(KIND_LABELS[kind]).not.toBe('');
    expect(zPushPayload.safeParse(pushPayloadOf([A])).success).toBe(true);
  });
});
