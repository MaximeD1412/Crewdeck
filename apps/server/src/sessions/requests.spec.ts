import { zDecision } from '@crewdeck/contracts';
import { requestDecision, requestDecisionKind } from './requests.js';

const SESSION = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a91',
  projectId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a92',
  role: 'design',
  title: 'Agenda partagé',
  projectName: 'Personal OS',
};

describe('the Décision of a request waiting in a Session', () => {
  it('is a « Question de l’agent », accent, for a question: the Session’s title, its Projet, the request’s seq and the Rôle', () => {
    const input = requestDecision(SESSION, { requestId: 'toolu_01AskAgendaRules0000001', kind: 'question', seq: 4 });

    expect(input).toEqual({
      kind: 'agent-question',
      projectId: SESSION.projectId,
      projectName: 'Personal OS',
      subjectType: 'session-request',
      subjectId: 'toolu_01AskAgendaRules0000001',
      label: 'Agenda partagé',
      metaParts: ['session'],
      tone: 'accent',
      link: `/a-toi?session=${SESSION.id}`,
      params: { sessionId: SESSION.id, requestSeq: 4, role: 'design' },
    });
    expect(() =>
      zDecision.parse({ ...input, id: SESSION.id, state: 'open', outcome: null, createdAt: '2026-11-19T10:00:00.000Z', resolvedAt: null }),
    ).not.toThrow();
  });

  it('is a « Permission demandée », caution, for a permission', () => {
    expect(requestDecision(SESSION, { requestId: 'toolu_01PushAgenda0000000001', kind: 'permission', seq: 6 })).toMatchObject({
      kind: 'permission-requested',
      tone: 'caution',
      subjectId: 'toolu_01PushAgenda0000000001',
      params: { requestSeq: 6 },
    });
    expect(requestDecisionKind('permission')).toBe('permission-requested');
  });

  it('keeps a long title within the label’s bound', () => {
    expect(requestDecision({ ...SESSION, title: 'x'.repeat(300) }, { requestId: 'r', kind: 'question', seq: 1 }).label).toHaveLength(120);
  });
});
