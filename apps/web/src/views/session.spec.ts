import type { SettingsState, AgentSession, EngineEvent, Project, Runner } from '@crewdeck/contracts';
import { COMPOSANTS, formatHour, t } from '@crewdeck/sdk';
import type { PlacedNode } from '../placed.js';
import { sessionNotFoundView, sessionView, type SessionViewInput } from './session.js';

const NOW = new Date('2026-11-11T14:05:00.000Z');
const secondsAgo = (n: number) => new Date(NOW.getTime() - n * 1000).toISOString();

const PROJECT_ID = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02';
const SESSION: AgentSession = {
  id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a7b',
  projectId: PROJECT_ID,
  role: 'design',
  engine: 'claude-code',
  model: 'claude-opus-5-5',
  title: 'Concevoir · Agenda partagé',
  state: 'active',
  interruptedReason: null,
  outcome: null,
  error: null,
  stepRunId: null,
  branch: 'design/agenda-partage',
  startedAt: secondsAgo(600),
  endedAt: null,
};
const PROJECT = { id: PROJECT_ID, displayName: 'Personal OS' } as Project;
const ONLINE = { state: 'online', lastSeenAt: secondsAgo(5) } as Runner;
const OFFLINE = { state: 'offline', lastSeenAt: secondsAgo(180) } as Runner;
const SETTINGS = { customRoles: [{ id: 'r-abcdefgh', name: 'Sécurité', createdAt: secondsAgo(9999) }], projects: [] } as unknown as SettingsState;

const toolCall = (seq: number, tool: string, target?: string, detail?: string): EngineEvent => ({
  kind: 'tool-call',
  seq,
  at: secondsAgo(100 - seq),
  callId: `call-${seq}`,
  tool,
  ...(target === undefined ? {} : { target }),
  ...(detail === undefined ? {} : { detail }),
});
const agent = (seq: number, text: string, final = true): EngineEvent => ({ kind: 'message', seq, at: secondsAgo(100 - seq), from: 'agent', text, final });

const view = (input: Partial<SessionViewInput> = {}) =>
  sessionView({
    session: SESSION,
    slices: { project: new Map([[PROJECT_ID, PROJECT]]), runner: ONLINE, settings: SETTINGS },
    events: [],
    sent: [],
    now: NOW,
    ...input,
  });

const stream = (children: readonly PlacedNode[]) => children.filter((node) => node.slot === undefined);
const composerOf = (children: readonly PlacedNode[]) => children.find((node) => node.slot === 'composer');

describe('sessionView', () => {
  it('heads the Session with its title and « Projet · Rôle · Moteur », « Agrandir » left out', () => {
    const { data } = view();
    expect(COMPOSANTS.Session.data.parse(data)).toEqual(data);
    expect(data).toMatchObject({
      id: SESSION.id,
      title: 'Concevoir · Agenda partagé',
      meta: 'Personal OS · Conception · Claude Code',
      state: 'active',
      resumeDisabledReason: null,
      expandable: false,
    });
  });

  it('names a Rôle the Pilote added by its name', () => {
    expect(view({ session: { ...SESSION, role: 'r-abcdefgh', engine: 'codex' } }).data.meta).toBe('Personal OS · Sécurité · Codex');
  });

  it.each([
    ['starting', 'active'],
    ['active', 'active'],
    ['waiting', 'waiting'],
    ['stopped', 'stopped'],
    ['interrupted', 'interrupted'],
    ['ended', 'stopped'],
  ] as const)('shows a %s Session as %s', (state, shown) => {
    expect(view({ session: { ...SESSION, state } }).data.state).toBe(shown);
  });

  it('maps the events to the agent’s messages and tool calls, the result’s detail on its call', () => {
    const { children } = view({
      events: [
        toolCall(1, 'Read', 'docs/product/prd.md'),
        { kind: 'tool-result', seq: 2, at: secondsAgo(90), callId: 'call-1', ok: true, detail: '281 lignes' },
        agent(3, 'Je regarde le PRD.'),
        toolCall(4, 'Grep', 'agenda · apps/web/src', '14 fichiers'),
        { kind: 'usage', seq: 5, at: secondsAgo(80), inputTokens: 10 },
      ],
    });
    expect(stream(children)).toEqual([
      { tag: 'cd-tool-call', data: { tool: 'Read', target: 'docs/product/prd.md', detail: '281 lignes' } },
      { tag: 'cd-message', data: { from: 'agent', text: 'Je regarde le PRD.', at: secondsAgo(97) } },
      { tag: 'cd-tool-call', data: { tool: 'Grep', target: 'agenda · apps/web/src', detail: '14 fichiers' } },
    ]);
  });

  it('joins a message’s deltas as it streams, then takes the whole message', () => {
    const streaming = view({ events: [agent(1, 'Noté. ', false), agent(2, 'L’agenda', false)] });
    expect(stream(streaming.children)).toEqual([{ tag: 'cd-message', data: { from: 'agent', text: 'Noté. L’agenda', at: secondsAgo(99) } }]);
    const whole = view({ events: [agent(1, 'Noté. ', false), agent(2, 'L’agenda', false), agent(3, 'Noté. L’agenda a déjà les récurrents.')] });
    expect(stream(whole.children)).toEqual([{ tag: 'cd-message', data: { from: 'agent', text: 'Noté. L’agenda a déjà les récurrents.', at: secondsAgo(99) } }]);
  });

  it.each([
    ['an error of the Moteur', { kind: 'error', seq: 3, at: secondsAgo(97), code: 'exit', message: 'Moteur arrêté' }],
    ['an interrupted turn', { kind: 'result', seq: 3, at: secondsAgo(97), status: 'interrupted' }],
  ] as const)('keeps a message cut by %s apart from the next one, once resumed', (_, end) => {
    const { children } = view({ events: [agent(1, 'Les nuages ', false), agent(2, 'flottent', false), end, agent(4, 'Ma réponse ', false), agent(5, 'Ma réponse reprend.')] });
    const texts = stream(children).map((node) => (node.data as { text: string }).text);
    expect(texts[0]).toBe('Les nuages flottent');
    expect(texts.at(-1)).toBe('Ma réponse reprend.');
  });

  it('replays a log a killed Runner cut after a usage report, its turn ended by the Runner on resume: both messages kept', () => {
    const { children } = view({
      events: [
        agent(1, 'Les nuages ', false),
        agent(2, 'flottent', false),
        { kind: 'usage', seq: 3, at: secondsAgo(97), outputTokens: 12 },
        { kind: 'result', seq: 4, at: secondsAgo(96), status: 'interrupted' },
        agent(5, 'Ma réponse ', false),
        agent(6, 'Ma réponse reprend.'),
      ],
    });
    expect(stream(children).map((node) => (node.data as { text: string }).text)).toEqual(['Les nuages flottent', 'Ma réponse reprend.']);
  });

  it('a usage report while it streams does not cut the message', () => {
    const { children } = view({ events: [agent(1, 'Noté. ', false), { kind: 'usage', seq: 2, at: secondsAgo(98), outputTokens: 12 }, agent(3, 'Noté. L’agenda.')] });
    expect(stream(children).map((node) => (node.data as { text: string }).text)).toEqual(['Noté. L’agenda.']);
  });

  it('shows a question and a permission request as the agent’s message until SESSION-3', () => {
    const { children } = view({
      events: [
        { kind: 'question', seq: 1, at: secondsAgo(99), requestId: 'q-1', title: 'Qui voit un agenda partagé ?', options: [{ label: 'Ses membres' }], multiple: false },
        { kind: 'permission-request', seq: 2, at: secondsAgo(98), requestId: 'p-1', tool: 'Bash', command: 'git push' },
      ],
    });
    expect(stream(children).map((node) => (node.data as { text: string }).text)).toEqual([
      'Qui voit un agenda partagé ?',
      t('session.permissionRequest', { tool: 'Bash', command: 'git push' }),
    ]);
  });

  it('puts the Pilote’s messages after the event they followed', () => {
    const { children } = view({
      events: [toolCall(1, 'Read', 'CONTEXT.md'), agent(2, 'Je prépare les questions.')],
      sent: [
        { text: 'Pense aux récurrents.', at: secondsAgo(50), afterSeq: 1 },
        { text: 'Et aux fuseaux.', at: secondsAgo(10), afterSeq: 2 },
      ],
    });
    expect(stream(children).map((node) => [node.tag, (node.data as { from?: string }).from ?? null])).toEqual([
      ['cd-tool-call', null],
      ['cd-message', 'pilote'],
      ['cd-message', 'agent'],
      ['cd-message', 'pilote'],
    ]);
    expect(stream(children)[1]?.data).toEqual({ from: 'pilote', text: 'Pense aux récurrents.', at: secondsAgo(50) });
  });

  it('says « <Moteur> travaille » with the time since the last event while active', () => {
    expect(view({ events: [agent(1, 'Bonjour')], now: new Date(Date.parse(secondsAgo(99)) + 42_000) }).data.status).toBe(
      t('session.working', { engine: 'Claude Code', duration: '42 s' }),
    );
    expect(view({ now: new Date(Date.parse(SESSION.startedAt) + 3 * 60_000 + 5_000) }).data.status).toBe(
      t('session.working', { engine: 'Claude Code', duration: '3 min' }),
    );
    expect(view({ now: new Date(Date.parse(SESSION.startedAt) + 2 * 3_600_000) }).data.status).toBe(
      t('session.working', { engine: 'Claude Code', duration: '2 h' }),
    );
    expect(view({ session: { ...SESSION, state: 'waiting' } }).data.status).toBeNull();
  });

  it('offers to write to the agent while it runs, without a mic unless the panel gives its dictation', () => {
    for (const state of ['active', 'waiting'] as const) {
      const composer = composerOf(view({ session: { ...SESSION, state } }).children);
      expect(composer).toEqual({
        tag: 'cd-composer',
        slot: 'composer',
        data: { placeholder: t('session.composer.running'), hint: null, state: 'idle', value: '', dictation: { available: false, state: 'idle', elapsedSeconds: 0, error: null, notice: false } },
      });
      expect(COMPOSANTS.Composer.data.parse(composer?.data)).toEqual(composer?.data);
    }
  });

  it('once stopped by the Pilote, the stop Banner with its time after the conversation, and writing resumes it', () => {
    const endedAt = '2026-11-11T14:12:00.000Z';
    const { data, children } = view({ session: { ...SESSION, state: 'stopped', endedAt }, events: [agent(1, 'Noté.')] });
    expect(data).toMatchObject({ state: 'stopped', status: null, resumeDisabledReason: null });
    expect(stream(children).at(-1)).toEqual({
      tag: 'cd-banner',
      data: { tone: 'neutral', title: t('session.stopped.title', { time: formatHour(endedAt) }), icon: 'pause' },
      text: t('session.stopped.body'),
    });
    expect(composerOf(children)?.data).toMatchObject({ placeholder: t('session.composer.stopped'), state: 'idle' });
  });

  it('an interrupted Session offers to write to resume it, without the stop Banner', () => {
    const { children } = view({ session: { ...SESSION, state: 'interrupted', interruptedReason: 'runner-restarted' }, events: [agent(1, 'Noté.')] });
    expect(stream(children).map((node) => node.tag)).toEqual(['cd-message']);
    expect(composerOf(children)?.data).toMatchObject({ placeholder: t('session.composer.stopped'), state: 'idle' });
  });

  it('an ended Session shows as stopped, without the stop Banner nor a composer, « Reprendre » disabled', () => {
    const { data, children } = view({ session: { ...SESSION, state: 'ended', outcome: 'ok', endedAt: secondsAgo(30) }, events: [agent(1, 'Fini.')] });
    expect(data).toMatchObject({ state: 'stopped', resumeDisabledReason: t('session.resumeDisabled.ended') });
    expect(children.map((node) => node.tag)).toEqual(['cd-message']);
  });

  it('while the Runner is offline, only its title and state: « Conversation sur ton Runner », the composer and « Reprendre » disabled', () => {
    const { data, children } = view({
      session: { ...SESSION, state: 'interrupted', interruptedReason: 'runner-offline' },
      slices: { project: new Map([[PROJECT_ID, PROJECT]]), runner: OFFLINE, settings: SETTINGS },
      events: [agent(1, 'Ce qui ne doit plus se voir')],
      sent: [{ text: 'Ni ceci', at: secondsAgo(10), afterSeq: 1 }],
    });
    expect(data).toMatchObject({
      meta: t('session.meta.offline', { meta: 'Personal OS · Conception · Claude Code' }),
      state: 'interrupted',
      resumeDisabledReason: t('session.resumeDisabled.offline'),
      status: null,
    });
    expect(JSON.stringify(children)).not.toContain('Ce qui ne doit plus se voir');
    expect(JSON.stringify(children)).not.toContain('Ni ceci');
    expect(children).toEqual([
      {
        tag: 'cd-empty',
        data: { icon: 'lock', title: t('session.offline.title') },
        text: t('session.offline.body'),
        children: [
          { tag: 'cd-button', slot: 'actions', data: { label: t('decision.runnerOffline.openRunner'), variant: 'secondary', size: 'md', icon: 'server' } },
        ],
      },
      {
        tag: 'cd-composer',
        slot: 'composer',
        data: { placeholder: t('session.composer.offline'), hint: null, state: 'disabled', value: '', dictation: { available: false, state: 'idle', elapsedSeconds: 0, error: null, notice: false } },
      },
    ]);
  });
});

describe('sessionNotFoundView', () => {
  it('is the « introuvable » empty state with « Fermer »', () => {
    expect(sessionNotFoundView()).toEqual({
      tag: 'cd-empty',
      data: { icon: 'alert', title: t('session.notFound.title') },
      text: t('session.notFound.body'),
      children: [{ tag: 'cd-button', slot: 'actions', data: { label: t('session.close'), variant: 'secondary', size: 'md', icon: 'x' } }],
    });
  });
});
