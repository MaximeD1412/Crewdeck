import { type AgentSession, type Event, type SessionStateMessage, zAgentSession, zAgentSessionList, zState } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { AppError } from '../../src/errors/app-error.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { EventsBus } from '../../src/realtime/events.bus.js';
import { Transactions } from '../../src/realtime/transactions.js';
import { RunnerPresence } from '../../src/runners/runner-presence.service.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { SessionHooks } from '../../src/sessions/session-hooks.js';
import { type StartSession, SessionsService } from '../../src/sessions/sessions.service.js';
import { FakeRunner } from '../../src/testing/fake-runner.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
import { connectRunner, type FakeRunnerClient } from '../fakes/runner.js';
import { expectEnvelope, expectFields, startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl, CREWDECK_COMMIT: 'abc1234' });
const ORIGIN = appOrigin(env);

const sql = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
};

/** Empties the tables; retried while the work of a socket just closed (its Runner offline, its Sessions interrupted) still holds their rows. */
const reset = async (): Promise<void> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await sql('TRUNCATE pilots CASCADE');
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== '40P01' || attempt === 5) throw error;
    }
  }
};

interface Tab {
  id: string;
  cookie: string;
}

const STEP = { stepRunId: '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0a1b', stepKind: 'code' } as const;

/** The Projet's worktree Commandes as the page seals them: bytes the server only carries. */
const WORKTREE_COMMANDS = { key: Buffer.alloc(60, 0xd1).toString('base64url'), ciphertext: Buffer.alloc(48, 0xd2).toString('base64url') };

describe('the Sessions against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let sessions: SessionsService;
  const sockets: FakeRunnerClient[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    prisma = app.get(PrismaService);
    sessions = app.get(SessionsService);
  });

  afterAll(async () => {
    await reset();
    await app.close();
  });

  beforeEach(reset);

  afterEach(async () => {
    await Promise.all(sockets.splice(0).map((socket) => socket.close()));
  });

  const pilot = async (login = 'octocat'): Promise<Tab> => {
    const id = newId();
    await sql(`WITH p AS (INSERT INTO pilots (id, display_name, time_zone, getting_started_step) VALUES ($1, $3, 'Europe/Paris', 'done') RETURNING id) INSERT INTO pilot_identities (id, pilot_id, provider, subject, login) SELECT gen_random_uuid(), id, 'github', $2::text, $3 FROM p`, [
      id,
      Math.floor(Math.random() * 1e9),
      login,
    ]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  /** A Projet `acme/shop` of `tab`, its code on `code` (a Local folder, or GitHub). */
  const project = async (tab: Tab, code: 'github' | 'local' = 'github'): Promise<string> => {
    const id = newId();
    await sql(
      `INSERT INTO projects (id, pilot_id, repository_id, github_repo_id, owner, name, full_name, display_name, release_branch, integration_branch, has_code, inventory_state)
       VALUES ($1, $2, $3, $4, 'acme', 'shop', 'acme/shop', 'shop', 'main', 'develop', true, 'not-needed')`,
      [id, tab.id, newId(), Math.floor(Math.random() * 1e9)],
    );
    await sql(`INSERT INTO artifact_sources (id, pilot_id, project_id, "group", source, since) VALUES ($1, $2, $3, 'ticket', 'github', now()), ($4, $2, $3, 'code', $5, now())`, [
      newId(),
      tab.id,
      id,
      newId(),
      code,
    ]);
    return id;
  };

  const call = (tab: Tab | undefined, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method,
      headers: { ...(tab ? { cookie: tab.cookie } : {}), origin: ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const online = async (tab: Tab, sessionsKnown?: { sessionId: string; alive: boolean }[]): Promise<FakeRunnerClient> => {
    const { token } = await createLinkedRunner(prisma, tab.id);
    return connect(token, sessionsKnown);
  };

  const connect = async (token: string, sessionsKnown?: { sessionId: string; alive: boolean }[]): Promise<FakeRunnerClient> => {
    const socket = await connectRunner(url, token);
    sockets.push(socket);
    socket.hello(sessionsKnown ? { sessions: sessionsKnown } : {});
    await socket.expect('hello.accepted');
    return socket;
  };

  const input = (projectId: string, overrides: Partial<StartSession> = {}): StartSession => ({
    projectId,
    role: 'code',
    engine: 'claude-code',
    model: 'claude-opus-5-5',
    title: 'Le panier garde ses articles',
    branch: 'feat/12-panier',
    step: STEP,
    ...overrides,
  });

  const start = (tab: Tab, values: StartSession): Promise<AgentSession> =>
    runInPilotScope(tab.id, () => app.get(Transactions).run((tx) => sessions.start(tx, values)));

  const row = async (id: string) =>
    (
      await sql<{ state: string; interrupted_reason: string | null; outcome: string | null; error: string | null; engine_session_id: string | null; ended_at: Date | null; last_seq: string }>(
        'SELECT state, interrupted_reason, outcome, error, engine_session_id, ended_at, last_seq FROM agent_sessions WHERE id = $1',
        [id],
      )
    )[0];

  const report = (socket: FakeRunnerClient, message: Omit<SessionStateMessage, 'type' | 'id' | 'at'>): void => socket.send({ type: 'session.state', ...message });

  const settle = (id: string, state: string): Promise<void> => vi.waitFor(async () => expect((await row(id))?.state).toBe(state), { timeout: 5_000 });

  /** The `agent-session` events published from now on, for `tab`. */
  const listen = (tab: Tab): { events: Event[]; stop: () => void } => {
    const events: Event[] = [];
    const stop = app.get(EventsBus).subscribe(tab.id, (event) => {
      if (event.type === 'agent-session.upserted') events.push(event);
    });
    return { events, stop };
  };

  /** A Session of `tab` straight in the table, `state` with its other columns as given. */
  const insert = async (tab: Tab, projectId: string, columns: { state: string; startedAt?: Date; endedAt?: Date | null; engineSessionId?: string | null; lastSeq?: number }): Promise<string> => {
    const id = newId();
    await sql(
      `INSERT INTO agent_sessions (id, pilot_id, project_id, role, engine, model, title, branch, base, permission_mode, state, outcome, step_run_id, step_kind, engine_session_id, started_at, ended_at, last_seq)
       VALUES ($1, $2, $3, 'code', 'claude-code', 'claude-opus-5-5', 'Le panier', 'feat/12-panier', 'develop', 'bypass', $4, $5, NULL, NULL, $6, $7, $8, $9)`,
      [
        id,
        tab.id,
        projectId,
        columns.state,
        columns.state === 'ended' ? 'ok' : null,
        columns.engineSessionId ?? null,
        columns.startedAt ?? new Date(),
        columns.endedAt ?? (columns.state === 'ended' ? new Date() : null),
        columns.lastSeq ?? 0,
      ],
    );
    return id;
  };

  describe('SessionsService.start', () => {
    it('writes the row and its event, then sends session.start with the Projet’s origin and the Étape’s permission mode', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      const socket = await online(alice);
      const { events, stop } = listen(alice);

      const session = await start(alice, input(projectId));

      const message = await socket.expect('session.start');
      expect(message).toMatchObject({
        sessionId: session.id,
        projectId,
        origin: { kind: 'github', owner: 'acme', name: 'shop' },
        branch: 'feat/12-panier',
        base: 'develop',
        engine: 'claude-code',
        model: 'claude-opus-5-5',
        role: 'code',
        permissionMode: 'bypass',
        step: STEP,
        title: 'Le panier garde ses articles',
        worktreeCommands: null,
      });
      expect(zAgentSession.parse(session)).toMatchObject({ state: 'starting', stepRunId: STEP.stepRunId, outcome: null, error: null, endedAt: null });
      await vi.waitFor(() => expect(events).toHaveLength(1));
      stop();
      expect(events[0]?.payload).toEqual(session);
      expect(Number((await row(session.id))?.last_seq)).toBe(events[0]?.seq);
    });

    it('sends the Projet’s worktree Commandes sealed as stored, at its start, at its start again and once its Runner is back, and never in its view', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      await sql(`INSERT INTO project_settings (project_id, pilot_id, roles, worktree_commands, updated_at) VALUES ($1, $2, '{}', $3, now())`, [projectId, alice.id, WORKTREE_COMMANDS]);
      const { token } = await createLinkedRunner(prisma, alice.id);
      const socket = await connect(token);

      const session = await start(alice, input(projectId, { branch: 'feat/14-commandes' }));
      expect(await socket.expect('session.start')).toMatchObject({ sessionId: session.id, worktreeCommands: WORKTREE_COMMANDS });
      expect(JSON.stringify(session)).not.toContain(WORKTREE_COMMANDS.ciphertext);

      const interrupted = await insert(alice, projectId, { state: 'interrupted' });
      expect((await call(alice, 'POST', `/api/sessions/${interrupted}/resume`, { seq: '0' })).status).toBe(200);
      expect(await socket.expect('session.start')).toMatchObject({ sessionId: interrupted, worktreeCommands: WORKTREE_COMMANDS });

      await socket.close();
      const meanwhile = await start(alice, input(projectId, { branch: 'feat/13-apres' }));
      const back = await connect(token);
      expect(await back.expect('session.start')).toMatchObject({ sessionId: meanwhile.id, worktreeCommands: WORKTREE_COMMANDS });
      const listed = await call(alice, 'GET', `/api/sessions/${meanwhile.id}`);
      expect(await listed.text()).not.toContain(WORKTREE_COMMANDS.ciphertext);
    });

    it('asks auto of a Session without an Étape, or of an Étape that does not work in its worktree, and starts it from the base given', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      const socket = await online(alice);

      await start(alice, input(projectId, { step: undefined, role: 'r-a1b2c3d4', base: 'main' }));
      const free = await socket.expect('session.start');
      await start(alice, input(projectId, { step: { stepRunId: STEP.stepRunId, stepKind: 'prd' }, branch: 'feat/13-prd' }));
      const prd = await socket.expect('session.start');
      await start(alice, input(projectId, { step: { stepRunId: STEP.stepRunId, stepKind: 'review' }, branch: 'feat/14-review' }));
      const review = await socket.expect('session.start');

      expect(free).toMatchObject({ permissionMode: 'auto', role: 'r-a1b2c3d4', base: 'main' });
      expect(free).not.toHaveProperty('step');
      expect(prd.permissionMode).toBe('auto');
      expect(review.permissionMode).toBe('bypass');
    });

    it('writes nothing and sends nothing when the caller’s transaction rolls back', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      const socket = await online(alice);

      await expect(
        runInPilotScope(alice.id, () =>
          app.get(Transactions).run(async (tx) => {
            await sessions.start(tx, input(projectId));
            throw new Error('the caller fails after the start');
          }),
        ),
      ).rejects.toThrow('the caller fails after the start');
      await start(alice, input(projectId, { branch: 'feat/13-after' }));

      expect((await socket.expect('session.start')).branch).toBe('feat/13-after');
      expect(await sql('SELECT branch FROM agent_sessions')).toEqual([{ branch: 'feat/13-after' }]);
      expect(socket.received().filter((message) => message.type === 'session.start')).toHaveLength(1);
    });

    it('keeps a Session started while the Runner is offline starting, and sends it once the Runner connects', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      const { token } = await createLinkedRunner(prisma, alice.id);

      const session = await start(alice, input(projectId));
      expect((await row(session.id))?.state).toBe('starting');
      const socket = await connect(token);

      expect((await socket.expect('session.start')).sessionId).toBe(session.id);
      expect((await row(session.id))?.state).toBe('starting');
    });

    it('sends a Session started while the Runner was swept offline once its heartbeat brings it back', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      const socket = await online(alice);
      const runner = (await sql<{ id: string }>('SELECT id FROM runners WHERE pilot_id = $1', [alice.id]))[0]?.id ?? '';
      await runInPilotScope(alice.id, () => app.get(RunnerPresence).expire(alice.id, runner, new Date(Date.now() + 60_000)));

      const session = await start(alice, input(projectId));
      socket.heartbeat();

      expect((await socket.expect('session.start')).sessionId).toBe(session.id);
    });

    it('refuses a Projet whose code is not on GitHub with 422 sessions.no-origin, and writes no row', async () => {
      const alice = await pilot();
      const projectId = await project(alice, 'local');

      const failure = await start(alice, input(projectId)).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AppError);
      expect(failure).toMatchObject({ status: 422, code: 'sessions.no-origin', message: 'Ce Projet n’a pas de dépôt pour les Sessions.' });
      expect(await sql('SELECT id FROM agent_sessions')).toEqual([]);
    });
  });

  describe('the Runner’s session.state', () => {
    it('takes active, its Moteur’s id, waiting, then ended with when, each with its event, and calls the ended hooks in the transaction', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      const socket = await online(alice);
      const ended: AgentSession[] = [];
      const remove = app.get(SessionHooks).onEnded(async (tx, session) => {
        ended.push(session);
        expect(await tx.agentSession.count({ where: { id: session.id, state: 'ended' } })).toBe(1);
      });
      const session = await start(alice, input(projectId));
      const { events, stop } = listen(alice);

      report(socket, { sessionId: session.id, state: 'active', engineSessionId: 'eng-1' });
      await settle(session.id, 'active');
      report(socket, { sessionId: session.id, state: 'waiting' });
      await settle(session.id, 'waiting');
      report(socket, { sessionId: session.id, state: 'ended', outcome: 'ok' });
      await settle(session.id, 'ended');
      remove();
      stop();

      expect(events.map((event) => (event.payload as AgentSession).state)).toEqual(['active', 'waiting', 'ended']);
      expect(await row(session.id)).toMatchObject({ outcome: 'ok', error: null, engine_session_id: 'eng-1', ended_at: expect.any(Date) });
      expect(ended).toEqual([expect.objectContaining({ id: session.id, state: 'ended', outcome: 'ok', endedAt: expect.any(String) })]);
    });

    it('keeps the error’s code of a Session ended in error, and an ended Session stays so', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      const socket = await online(alice);
      const session = await start(alice, input(projectId));

      report(socket, { sessionId: session.id, state: 'ended', outcome: 'error', error: 'setup-failed' });
      await settle(session.id, 'ended');
      report(socket, { sessionId: session.id, state: 'active' });
      const other = await start(alice, input(projectId, { branch: 'feat/13-next' }));
      report(socket, { sessionId: other.id, state: 'active' });
      await settle(other.id, 'active');

      expect(await row(session.id)).toMatchObject({ state: 'ended', outcome: 'error', error: 'setup-failed' });
    });

    it('ignores the report of another Pilote’s Session', async () => {
      const alice = await pilot();
      const bob = await pilot('hubot');
      const session = await start(bob, input(await project(bob)));
      const socket = await online(alice);
      const own = await start(alice, input(await project(alice)));

      report(socket, { sessionId: session.id, state: 'active' });
      report(socket, { sessionId: own.id, state: 'active' });
      await settle(own.id, 'active');

      expect((await row(session.id))?.state).toBe('starting');
    });
  });

  describe('the Runner’s session.waiting and session.answered', () => {
    const decisions = (sessionId: string) =>
      sql<{ kind: string; subject_type: string; subject_id: string; label: string; meta_parts: string[]; project_name: string | null; tone: string; link: string; params: unknown; state: string; outcome: string | null }>(
        `SELECT kind, subject_type, subject_id, label, meta_parts, project_name, tone, link, params, state, outcome FROM decisions WHERE params->>'sessionId' = $1 ORDER BY created_at, subject_id`,
        [sessionId],
      );

    const QUESTION = 'Qui peut modifier un événement d’un agenda partagé ?';
    const COMMAND = 'git push origin design/agenda-partage';

    it('raises one Décision per request, the Session waiting, and the stored rows hold no question nor command', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      const socket = await online(alice);
      const session = await start(alice, input(projectId, { role: 'design', step: undefined }));
      report(socket, { sessionId: session.id, state: 'active' });
      await settle(session.id, 'active');

      socket.send({ type: 'session.waiting', sessionId: session.id, requestId: 'toolu_q1', kind: 'question', seq: 4 });
      socket.send({ type: 'session.waiting', sessionId: session.id, requestId: 'toolu_p1', kind: 'permission', seq: 6 });
      await vi.waitFor(async () => expect(await decisions(session.id)).toHaveLength(2), { timeout: 5_000 });

      expect(await decisions(session.id)).toEqual([
        {
          kind: 'agent-question',
          subject_type: 'session-request',
          subject_id: 'toolu_q1',
          label: 'Le panier garde ses articles',
          meta_parts: ['session'],
          project_name: 'shop',
          tone: 'accent',
          link: `/a-toi?session=${session.id}`,
          params: { sessionId: session.id, requestSeq: 4, role: 'design' },
          state: 'open',
          outcome: null,
        },
        expect.objectContaining({ kind: 'permission-requested', subject_id: 'toolu_p1', tone: 'caution', params: { sessionId: session.id, requestSeq: 6, role: 'design' } }),
      ]);
      expect((await row(session.id))?.state).toBe('waiting');
      const stored = JSON.stringify(await sql(`SELECT * FROM decisions`)) + JSON.stringify(await sql(`SELECT * FROM agent_sessions`));
      expect(stored).not.toContain(QUESTION);
      expect(stored).not.toContain(COMMAND);
    });

    it('resolves the Décision answered, the Session active once no other request waits, and an answer again does nothing', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      const socket = await online(alice);
      const session = await start(alice, input(projectId, { step: undefined }));
      report(socket, { sessionId: session.id, state: 'active' });
      socket.send({ type: 'session.waiting', sessionId: session.id, requestId: 'toolu_q1', kind: 'question', seq: 2 });
      socket.send({ type: 'session.waiting', sessionId: session.id, requestId: 'toolu_q2', kind: 'question', seq: 3 });
      await vi.waitFor(async () => expect(await decisions(session.id)).toHaveLength(2), { timeout: 5_000 });

      socket.send({ type: 'session.answered', sessionId: session.id, requestId: 'toolu_q1' });
      await vi.waitFor(async () => expect((await decisions(session.id))[0]).toMatchObject({ subject_id: 'toolu_q1', state: 'resolved', outcome: 'answered' }), { timeout: 5_000 });
      expect((await row(session.id))?.state).toBe('waiting');

      socket.send({ type: 'session.answered', sessionId: session.id, requestId: 'toolu_q2' });
      await settle(session.id, 'active');
      socket.send({ type: 'session.answered', sessionId: session.id, requestId: 'toolu_q2' });
      report(socket, { sessionId: session.id, state: 'active' });
      await vi.waitFor(async () => expect((await decisions(session.id)).map((d) => d.state)).toEqual(['resolved', 'resolved']), { timeout: 5_000 });
      expect(await sql(`SELECT count(*)::int AS n FROM decisions`)).toEqual([{ n: 2 }]);
    });

    it('keeps the Décisions of an interrupted Session open, and resolves them once it ended', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      const socket = await online(alice);
      const session = await start(alice, input(projectId, { step: undefined }));
      report(socket, { sessionId: session.id, state: 'active' });
      socket.send({ type: 'session.waiting', sessionId: session.id, requestId: 'toolu_p1', kind: 'permission', seq: 2 });
      await settle(session.id, 'waiting');

      await socket.close();
      await settle(session.id, 'interrupted');
      expect((await decisions(session.id)).map((d) => d.state)).toEqual(['open']);

      await runInPilotScope(alice.id, () =>
        sessions.report(alice.id, { type: 'session.state', id: newId(), at: new Date().toISOString(), sessionId: session.id, state: 'ended', outcome: 'ok' }),
      );
      expect(await decisions(session.id)).toEqual([expect.objectContaining({ state: 'resolved', outcome: 'ended' })]);
    });

    it('keeps the Décisions of a stopped Session open, and resolves them withdrawn once it resumes: the new run never takes them', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      const socket = await online(alice);
      const session = await start(alice, input(projectId, { step: undefined }));
      report(socket, { sessionId: session.id, state: 'active', engineSessionId: 'eng-1' });
      socket.send({ type: 'session.waiting', sessionId: session.id, requestId: 'toolu_q1', kind: 'question', seq: 2 });
      await settle(session.id, 'waiting');

      const stopped = await call(alice, 'POST', `/api/sessions/${session.id}/stop`, { seq: (await row(session.id))?.last_seq ?? '0' });
      expect(stopped.status).toBe(200);
      expect((await decisions(session.id)).map((d) => d.state)).toEqual(['open']);

      const resumed = await call(alice, 'POST', `/api/sessions/${session.id}/resume`, { seq: (await row(session.id))?.last_seq ?? '0' });
      expect(resumed.status).toBe(200);
      expect(await decisions(session.id)).toEqual([expect.objectContaining({ subject_id: 'toolu_q1', state: 'resolved', outcome: 'withdrawn' })]);
      const state = zState.parse(await (await call(alice, 'GET', '/api/state')).json());
      expect(state.decisions.filter((decision) => decision.kind === 'agent-question')).toEqual([]);
    });
  });

  describe('the Runner away and back', () => {
    it('makes the live Sessions interrupted (runner-offline) when the Runner goes offline, and leaves the others', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      const socket = await online(alice);
      const active = await start(alice, input(projectId));
      const starting = await start(alice, input(projectId, { branch: 'feat/13-next' }));
      const done = await insert(alice, projectId, { state: 'ended' });
      const stopped = await insert(alice, projectId, { state: 'stopped' });
      report(socket, { sessionId: active.id, state: 'active' });
      await settle(active.id, 'active');

      await socket.close();
      await settle(active.id, 'interrupted');
      await settle(starting.id, 'interrupted');

      expect(await row(active.id)).toMatchObject({ interrupted_reason: 'runner-offline' });
      expect(await row(starting.id)).toMatchObject({ interrupted_reason: 'runner-offline' });
      expect((await row(done))?.state).toBe('ended');
      expect((await row(stopped))?.state).toBe('stopped');
    });

    it('makes the Sessions the Runner was running interrupted (runner-restarted) at its hello, stops those it reports alive, and only resume restarts them', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      const { token } = await createLinkedRunner(prisma, alice.id);
      const first = await connect(token);
      const active = await start(alice, input(projectId));
      const waiting = await start(alice, input(projectId, { branch: 'feat/13-waiting' }));
      report(first, { sessionId: active.id, state: 'active', engineSessionId: 'eng-1' });
      report(first, { sessionId: waiting.id, state: 'waiting', engineSessionId: 'eng-2' });
      await settle(active.id, 'active');
      await settle(waiting.id, 'waiting');

      // The same Runner on a new socket, its Moteur still running one of them.
      const second = await connect(token, [
        { sessionId: active.id, alive: true },
        { sessionId: waiting.id, alive: false },
      ]);
      await settle(active.id, 'interrupted');
      await settle(waiting.id, 'interrupted');

      expect((await second.expect('session.stop')).sessionId).toBe(active.id);
      expect(second.received().filter((message) => message.type === 'session.stop')).toHaveLength(1);
      expect(await row(active.id)).toMatchObject({ interrupted_reason: 'runner-restarted', engine_session_id: 'eng-1' });
      // What the Runner says meanwhile does not restart it.
      report(second, { sessionId: active.id, state: 'stopped' });
      report(second, { sessionId: active.id, state: 'active' });
      const later = await start(alice, input(projectId, { branch: 'feat/14-later' }));
      report(second, { sessionId: later.id, state: 'active' });
      await settle(later.id, 'active');
      expect((await row(active.id))?.state).toBe('interrupted');
      expect(second.received().filter((message) => message.type === 'session.start' || message.type === 'session.resume').map((message) => message.sessionId)).toEqual([later.id]);

      const seq = (await row(active.id))?.last_seq ?? '0';
      const resumed = await call(alice, 'POST', `/api/sessions/${active.id}/resume`, { seq });
      expect(resumed.status).toBe(200);
      expect(zAgentSession.parse(await resumed.json())).toMatchObject({ id: active.id, state: 'starting', interruptedReason: null });
      expect((await second.expect('session.resume')).sessionId).toBe(active.id);
    });

    it('keeps a Session already interrupted so at the hello, and sends the Sessions started while the Runner was away', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      const { token } = await createLinkedRunner(prisma, alice.id);
      const first = await connect(token);
      const active = await start(alice, input(projectId));
      report(first, { sessionId: active.id, state: 'active' });
      await settle(active.id, 'active');
      await first.close();
      await settle(active.id, 'interrupted');
      const meanwhile = await start(alice, input(projectId, { branch: 'feat/13-meanwhile' }));

      const second = await connect(token, [{ sessionId: active.id, alive: false }]);

      expect((await second.expect('session.start')).sessionId).toBe(meanwhile.id);
      expect(await row(active.id)).toMatchObject({ state: 'interrupted', interrupted_reason: 'runner-offline' });
      expect((await row(meanwhile.id))?.state).toBe('starting');
    });
  });

  describe('/api/sessions', () => {
    it('lists the Pilote’s Sessions newest first, 50 a page, by Projet', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      const otherProject = await project(alice);
      const bob = await pilot('hubot');
      await insert(bob, await project(bob), { state: 'active' });
      const base = Date.now() - 1_000_000;
      const ids: string[] = [];
      for (let i = 0; i < 51; i += 1) ids.push(await insert(alice, projectId, { state: 'ended', startedAt: new Date(base + i * 1_000) }));
      const elsewhere = await insert(alice, otherProject, { state: 'active', startedAt: new Date(base - 1_000) });

      const first = zAgentSessionList.parse(await (await call(alice, 'GET', '/api/sessions')).json());
      const second = zAgentSessionList.parse(await (await call(alice, 'GET', `/api/sessions?cursor=${first.nextCursor ?? ''}`)).json());
      const filtered = zAgentSessionList.parse(await (await call(alice, 'GET', `/api/sessions?projectId=${otherProject}`)).json());

      expect(first.items.map((session) => session.id)).toEqual(ids.slice(1).reverse());
      expect(second).toEqual({ items: [expect.objectContaining({ id: ids[0] }), expect.objectContaining({ id: elsewhere })], nextCursor: null });
      expect(filtered.items.map((session) => session.id)).toEqual([elsewhere]);
    });

    it('answers one Session, 404 for another Pilote’s or no id, 400 with fields for a bad query', async () => {
      const alice = await pilot();
      const bob = await pilot('hubot');
      const own = await insert(alice, await project(alice), { state: 'active' });
      const theirs = await insert(bob, await project(bob), { state: 'active' });

      const one = await call(alice, 'GET', `/api/sessions/${own}`);
      expect(one.status).toBe(200);
      expect(zAgentSession.parse(await one.json())).toMatchObject({ id: own, state: 'active', role: 'code', engine: 'claude-code' });
      await expectEnvelope(await call(alice, 'GET', `/api/sessions/${theirs}`), 404, 'sessions.not-found');
      await expectEnvelope(await call(alice, 'GET', '/api/sessions/shop'), 404, 'sessions.not-found');
      await expectEnvelope(await call(alice, 'POST', `/api/sessions/${theirs}/stop`, { seq: '0' }), 404, 'sessions.not-found');
      await expectFields(await call(alice, 'GET', '/api/sessions?projectId=shop'), ['projectId']);
      await expectFields(await call(alice, 'GET', '/api/sessions?cursor=nope'), ['cursor']);
      await expectFields(await call(alice, 'POST', `/api/sessions/${own}/stop`, { seq: 'x' }), ['seq']);
      await expectFields(await call(alice, 'POST', `/api/sessions/${own}/resume`, {}), ['seq']);
    });

    it('stops a live Session, the Runner told, its event written, when kept in endedAt; 409 on a stale seq; 422 sessions.not-running for one not live', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      const socket = await online(alice);
      const session = await start(alice, input(projectId));
      report(socket, { sessionId: session.id, state: 'active', engineSessionId: 'eng-1' });
      await settle(session.id, 'active');
      const seq = (await row(session.id))?.last_seq ?? '0';

      await expectEnvelope(await call(alice, 'POST', `/api/sessions/${session.id}/stop`, { seq: String(Number(seq) - 1) }), 409, 'realtime.stale');
      const stopped = await call(alice, 'POST', `/api/sessions/${session.id}/stop`, { seq });

      expect(stopped.status).toBe(200);
      const body = zAgentSession.parse(await stopped.json());
      expect(body).toMatchObject({ state: 'stopped', endedAt: expect.any(String) });
      expect((await socket.expect('session.stop')).sessionId).toBe(session.id);
      expect(await row(session.id)).toMatchObject({ state: 'stopped', engine_session_id: 'eng-1', ended_at: new Date(body.endedAt ?? '') });
      const state = zState.parse(await (await call(alice, 'GET', '/api/state')).json());
      expect(state.sessions).toEqual([expect.objectContaining({ id: session.id, state: 'stopped' })]);
      const again = await call(alice, 'POST', `/api/sessions/${session.id}/stop`, { seq: String(state.seq) });
      const envelope = await expectEnvelope(again, 422, 'sessions.not-running');
      expect(envelope.message).toBe('Cette Session ne tourne pas.');
    });

    it('resumes a stopped Session on its Moteur’s id, its endedAt cleared, starts again one without; 422 sessions.not-resumable for a live one, runner.offline when the Runner is away', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      const withId = await insert(alice, projectId, { state: 'stopped', engineSessionId: 'eng-1', endedAt: new Date() });
      const withoutId = await insert(alice, projectId, { state: 'interrupted' });

      await expectEnvelope(await call(alice, 'POST', `/api/sessions/${withId}/resume`, { seq: '0' }), 422, 'runner.offline');
      const socket = await online(alice);
      const live = await insert(alice, projectId, { state: 'active' });
      const refused = await expectEnvelope(await call(alice, 'POST', `/api/sessions/${live}/resume`, { seq: '0' }), 422, 'sessions.not-resumable');
      expect(refused.message).toBe('Cette Session ne peut pas être reprise.');

      const resumed = await call(alice, 'POST', `/api/sessions/${withId}/resume`, { seq: '0' });
      expect(resumed.status).toBe(200);
      expect(zAgentSession.parse(await resumed.json())).toMatchObject({ state: 'starting', endedAt: null });
      expect((await socket.expect('session.resume')).sessionId).toBe(withId);
      expect((await call(alice, 'POST', `/api/sessions/${withoutId}/resume`, { seq: '0' })).status).toBe(200);
      expect(await socket.expect('session.start')).toMatchObject({ sessionId: withoutId, origin: { kind: 'github', owner: 'acme', name: 'shop' } });
      expect(await row(withId)).toMatchObject({ state: 'starting', ended_at: null });
    });

    it('gives in GET /api/state the Sessions not ended and those ended in the last 24 h', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      const live = await insert(alice, projectId, { state: 'waiting' });
      const recent = await insert(alice, projectId, { state: 'ended', endedAt: new Date(Date.now() - 60 * 60_000) });
      await insert(alice, projectId, { state: 'ended', startedAt: new Date(Date.now() - 50 * 60 * 60_000), endedAt: new Date(Date.now() - 48 * 60 * 60_000) });

      const state = zState.parse(await (await call(alice, 'GET', '/api/state')).json());

      expect(state.sessions.map((session) => session.id).sort()).toEqual([live, recent].sort());
    });
  });

  describe('the fake Runner of pnpm dev', () => {
    it('answers session.start with active, honours stop and resume on its Moteur’s id, ends its Sessions as the scenario says, and runs none once relaunched', async () => {
      const alice = await pilot();
      const projectId = await project(alice);
      const { token } = await createLinkedRunner(prisma, alice.id);
      const fake = new FakeRunner();
      try {
        await fake.connect(url, token);
        const session = await start(alice, input(projectId));
        await settle(session.id, 'active');
        const engineSessionId = (await row(session.id))?.engine_session_id;
        expect(engineSessionId).toEqual(expect.any(String));

        expect((await call(alice, 'POST', `/api/sessions/${session.id}/stop`, { seq: (await row(session.id))?.last_seq })).status).toBe(200);
        expect((await call(alice, 'POST', `/api/sessions/${session.id}/resume`, { seq: (await row(session.id))?.last_seq })).status).toBe(200);
        await settle(session.id, 'active');
        expect((await row(session.id))?.engine_session_id).toBe(engineSessionId);

        fake.endSessionsWith('error');
        const failing = await start(alice, input(projectId, { branch: 'feat/13-failing' }));
        await settle(failing.id, 'ended');
        expect(await row(failing.id)).toMatchObject({ outcome: 'error', error: 'engine-failed' });

        // Relaunched, it runs none of them: only the Pilote's resume does.
        fake.endSessionsWith(undefined);
        await fake.reconnect();
        await settle(session.id, 'interrupted');
        expect((await call(alice, 'POST', `/api/sessions/${session.id}/resume`, { seq: (await row(session.id))?.last_seq })).status).toBe(200);
        await settle(session.id, 'active');
      } finally {
        fake.reset();
      }
    });
  });
});
