import type { Decision, EngineEvent } from '@crewdeck/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { SessionEventRead } from '../../sessions/peek.js';
import { aToiView } from '../a-toi.js';
import './agent-question.js';
import './permission-requested.js';
import { actionsOf, decisionViews } from './registry.js';

const NOW = new Date('2026-11-19T09:05:00.000Z');
const SESSION = '019a6f1e-7c3d-7e4f-9a1b-5e5510000001';

const decision = (kind: 'agent-question' | 'permission-requested', params: Decision['params'] = {}): Decision => ({
  id: kind === 'agent-question' ? '0193a4f2-7c1e-7a10-8b2c-000000000001' : '0193a4f2-7c1e-7a10-8b2c-000000000002',
  kind,
  projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02',
  projectName: 'Personal OS',
  subjectType: 'session-request',
  subjectId: kind === 'agent-question' ? 'toolu_question' : 'toolu_permission',
  label: 'Agenda partagé',
  metaParts: ['session'],
  tone: kind === 'agent-question' ? 'accent' : 'caution',
  link: `/a-toi?session=${SESSION}`,
  params: { sessionId: SESSION, requestSeq: kind === 'agent-question' ? 4 : 6, role: 'design', ...params },
  state: 'open',
  outcome: null,
  createdAt: '2026-11-19T09:02:00.000Z',
  resolvedAt: null,
});

const QUESTION: EngineEvent = {
  seq: 4,
  at: '2026-11-19T09:02:00.000Z',
  kind: 'question',
  requestId: 'toolu_question',
  title: 'Quelles règles pour les créneaux partagés ?',
  options: [{ label: 'Une semaine', detail: 'Les créneaux de la semaine' }],
  multiple: false,
};
const PERMISSION: EngineEvent = {
  seq: 6,
  at: '2026-11-19T09:02:00.000Z',
  kind: 'permission-request',
  requestId: 'toolu_permission',
  tool: 'Bash',
  command: 'git push origin design/agenda-partage',
};

/** The row of `kind` as « À toi » lists it, its events read as `reads` says. */
const row = (subject: Decision, { online = true, read = (): SessionEventRead => ({ state: 'reading' }) } = {}) => {
  const sessionEvent = vi.fn(read);
  const [listed] = aToiView([subject], {}, { runnerOnline: online, now: NOW, sessionEvent, roleName: (role) => (role === 'design' ? 'Concevoir' : role) }).decisions;
  return { listed, sessionEvent };
};

describe('« Question de l’agent » (SESSION-3)', () => {
  it('reads its question from the Runner: the Session from the request’s seq, its title under the row', () => {
    const { listed, sessionEvent } = row(decision('agent-question'), { read: () => ({ state: 'read', event: QUESTION }) });
    expect(sessionEvent).toHaveBeenCalledWith(SESSION, 4);
    expect(listed).toMatchObject({
      kind: 'Question de l’agent',
      title: 'Agenda partagé',
      context: 'Quelles règles pour les créneaux partagés ?',
      actions: [{ id: 'answer', label: 'Répondre', primary: true, disabledReason: null }],
    });
  });

  it('shows no context while its question is read, « Ouvre la Session… » when it cannot be or the Runner is offline', () => {
    expect(row(decision('agent-question')).listed?.context).toBeNull();
    expect(row(decision('agent-question'), { read: () => ({ state: 'unavailable', reason: 'timeout' }) }).listed?.context).toBe(
      'Ouvre la Session pour lire la question.',
    );
    const offline = row(decision('agent-question'), { online: false, read: () => ({ state: 'read', event: QUESTION }) });
    expect(offline.listed?.context).toBe('Ouvre la Session pour lire la question.');
    expect(offline.sessionEvent).not.toHaveBeenCalled();
    // Another request's event at that seq is not its question.
    expect(row(decision('agent-question'), { read: () => ({ state: 'read', event: PERMISSION }) }).listed?.context).toBe(
      'Ouvre la Session pour lire la question.',
    );
  });

  it('« Répondre » opens the Session’s panel over « À toi »', async () => {
    const subject = decision('agent-question');
    const navigate = vi.fn();
    const [answer] = actionsOf(decisionViews.viewOf('agent-question'), subject);
    await answer?.run(subject, { navigate, client: { command: vi.fn() } });
    expect(navigate).toHaveBeenCalledWith(`/a-toi?session=${SESSION}`);
  });
});

describe('« Permission demandée » (SESSION-3)', () => {
  it('is titled « <Rôle> · <Session> », with « <outil> : <commande> » read from the Runner', () => {
    const { listed, sessionEvent } = row(decision('permission-requested'), { read: () => ({ state: 'read', event: PERMISSION }) });
    expect(sessionEvent).toHaveBeenCalledWith(SESSION, 6);
    expect(listed).toMatchObject({
      kind: 'Permission demandée',
      title: 'Concevoir · Agenda partagé',
      context: 'Bash : git push origin design/agenda-partage',
      actions: [{ id: 'open', label: 'Ouvrir', primary: true }],
    });
  });

  it('does not say the Rôle twice for a Session titled with it', () => {
    const titled = { ...decision('permission-requested'), label: 'Concevoir · Agenda partagé' };
    expect(row(titled).listed?.title).toBe('Concevoir · Agenda partagé');
  });

  it('says « Ouvre la Session pour lire la demande. » when the Runner is offline or the request cannot be read', () => {
    expect(row(decision('permission-requested'), { online: false }).listed?.context).toBe('Ouvre la Session pour lire la demande.');
    expect(row(decision('permission-requested', { sessionId: '' })).listed?.context).toBe('Ouvre la Session pour lire la demande.');
  });

  it('« Ouvrir » opens the Session’s panel; without a Session, its link', async () => {
    const navigate = vi.fn();
    const view = decisionViews.viewOf('permission-requested');
    const subject = decision('permission-requested');
    await actionsOf(view, subject)[0]?.run(subject, { navigate, client: { command: vi.fn() } });
    const loose = { ...decision('permission-requested', { sessionId: '' }), link: '/boucle?ticket=44' };
    await actionsOf(view, loose)[0]?.run(loose, { navigate, client: { command: vi.fn() } });
    expect(navigate.mock.calls).toEqual([[`/a-toi?session=${SESSION}`], ['/boucle?ticket=44']]);
  });
});
