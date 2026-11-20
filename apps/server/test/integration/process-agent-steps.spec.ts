import { type ArtifactRef, CATALOGUE, eventPayloadSchema, type EventType, type StepKind, type StepRun, zProjectList, zState } from '@crewdeck/contracts';
import { type INestApplication, Inject, Module, type OnModuleInit } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { z } from 'zod';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { WebhookDispatcher } from '../../src/github/webhooks/dispatcher.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { Engine } from '../../src/process/engine/engine.js';
import { EngineModule } from '../../src/process/engine/engine.module.js';
import { AgentSteps } from '../../src/process/engine/kinds/agent.js';
import { AgentStepsModule } from '../../src/process/engine/kinds/agent.module.js';
import { STEP_KIND_HANDLERS, type StepKindHandler, type StepKindHandlers, type StepResult } from '../../src/process/engine/kinds/handler.js';
import { type StepRunFinished, StepRunHooks } from '../../src/process/engine/kinds/step-run-hooks.js';
import { Transactions, type Tx } from '../../src/realtime/transactions.js';
import { RunnerWaitingWork } from '../../src/runners/waiting-work.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
import { deliverWebhook, TEST_WEBHOOK_SECRET, webhookFixture } from '../fakes/github.js';
import { connectRunner, type FakeRunnerClient } from '../fakes/runner.js';
import { authKeysEnv } from '../github-app.js';
import { startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');
const env = parseEnv({
  CREWDECK_ENV: 'test',
  DATABASE_URL: databaseUrl,
  CREWDECK_FAKES: '1',
  PUBLIC_URL: 'https://crewdeck.example',
  GITHUB_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
  ...authKeysEnv(),
});
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

const SENDER_ID = 9100001;
const INSTALLATION_ID = 51000001;
const created = webhookFixture<Record<string, unknown>>('installation.created');
const APP_REPO = { owner: 'octo-fixture', name: 'fixture-app', id: 71000001 };
const CHANGE: ArtifactRef = { portId: 'changement', type: 'code-change', id: '57', sha: 'a'.repeat(40) };
const SHA = 'b'.repeat(40);

/** What `StepRunHooks.onFinished` was called with, in order. */
const finished: { stepRunId: string; finished: StepRunFinished }[] = [];
/** What the report handler of `code` stored. */
const reports: unknown[] = [];

/** The other Étapes of « Développement », whose signal is their result: a test only watches them start. */
const OTHERS: readonly StepKind[] = ['checks', 'review', 'visual-review', 'merge'];
const other = (kind: StepKind): StepKindHandler => ({
  kind,
  start: () => Promise.resolve(CATALOGUE[kind].family === 'gate' ? 'waiting' : 'running'),
  onSignal: (_tx, _run, signal) => Promise.resolve(signal as StepResult | null),
});

/** « Code » as BOUCLE-3 will define it: its Contrat `code`, its change as output, its report a count of tests. */
@Module({ imports: [EngineModule, AgentStepsModule] })
class CodeKindModule implements OnModuleInit {
  constructor(
    @Inject(STEP_KIND_HANDLERS) private readonly handlers: StepKindHandlers,
    private readonly steps: AgentSteps,
    private readonly hooks: StepRunHooks,
  ) {}

  onModuleInit(): void {
    this.handlers.add(
      this.steps.defineAgentKind({
        kind: 'code',
        contractId: 'code',
        title: (_tx, run) => `Ticket #${run.phaseRun.itemId}`,
        branch: (_tx, run) => `feat/${run.phaseRun.itemId}-panier`,
        outputs: () => [CHANGE],
      }),
    );
    for (const kind of OTHERS) this.handlers.add(other(kind));
    this.steps.registerStepReport(
      'code',
      z.strictObject({ tests: z.int().min(0) }),
      (_tx, _run, report) => {
        reports.push(report);
        return Promise.resolve();
      },
      () => Promise.resolve(true),
    );
    this.hooks.onFinished((_tx, stepRun, outcome) => {
      finished.push({ stepRunId: stepRun.id, finished: outcome });
      return Promise.resolve();
    });
  }
}

interface StepRunRow {
  id: string;
  step_id: string;
  state: string;
  failure: string | null;
  session_id: string | null;
  contrat_verdict: unknown;
  outputs: ArtifactRef[];
}

describe('the agent Étapes against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let fakes: Fakes;
  let engine: Engine;
  let alice: { id: string; cookie: string };
  let projectId: string;
  const sockets: FakeRunnerClient[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp(env, { imports: [CodeKindModule] }));
    prisma = app.get(PrismaService);
    fakes = app.get<Fakes>(FAKES);
    engine = app.get(Engine);
  });

  /** A Runner's socket closed by the last test may still be interrupting its Sessions and their StepRuns: a deadlock is retried. */
  const empty = async (): Promise<void> => {
    for (let attempt = 1; ; attempt++) {
      try {
        await sql('TRUNCATE pilots, github_installations, github_deliveries CASCADE');
        return;
      } catch (error) {
        if ((error as { code?: string }).code !== '40P01' || attempt === 5) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
      }
    }
  };

  // The app first: a Runner's socket closed by a test may still be marking its Sessions.
  afterAll(async () => {
    await app.close();
    await empty();
  });

  afterEach(async () => {
    await Promise.all(sockets.splice(0).map((socket) => socket.close()));
  });

  const call = (method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method,
      headers: { cookie: alice.cookie, origin: ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const state = async () => zState.parse(await (await call('GET', '/api/state')).json());

  beforeEach(async () => {
    await empty();
    finished.length = 0;
    reports.length = 0;
    fakes.github.reset();
    fakes.github.seedRepo({ ...APP_REPO, installationId: INSTALLATION_ID, files: { 'README.md': '# App' } });
    const id = newId();
    await sql(
      `WITH p AS (INSERT INTO pilots (id, display_name, time_zone, getting_started_step, vault_key_version) VALUES ($1, 'octo-fixture', 'Europe/Paris', 'projects', 1) RETURNING id) INSERT INTO pilot_identities (id, pilot_id, provider, subject, login) SELECT gen_random_uuid(), id, 'github', $2::text, 'octo-fixture' FROM p`,
      [id, SENDER_ID],
    );
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    alice = { id, cookie: `${SESSION_COOKIE}=${token}` };
    expect((await deliverWebhook(url, { event: 'installation', payload: created })).status).toBe(202);
    await app.get(WebhookDispatcher).settled();
    const { seq, repositories } = await state();
    const followed = await call('POST', '/api/projects', { repositoryIds: repositories.map((repository) => repository.id), templateId: 'process-crewdeck', seq: String(seq) });
    expect(followed.status).toBe(201);
    projectId = zProjectList.parse(await followed.json()).items[0]?.id ?? '';
    // The Projet's Code on Codex, over the account's default.
    await sql(
      `INSERT INTO project_settings (project_id, pilot_id, roles, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (project_id) DO UPDATE SET roles = EXCLUDED.roles`,
      [projectId, alice.id, JSON.stringify({ code: { engine: 'codex', model: 'gpt-5.5' } })],
    );
  });

  const online = async (): Promise<FakeRunnerClient> => {
    const { token } = await createLinkedRunner(prisma, alice.id);
    const socket = await connectRunner(url, token);
    sockets.push(socket);
    socket.hello({});
    await socket.expect('hello.accepted');
    return socket;
  };

  const inAlice = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => runInPilotScope(alice.id, () => app.get(Transactions).run(fn));
  const admit = (ticket: string) => inAlice((tx) => engine.admit(tx, { projectId, phaseId: 'ph-dev', item: { type: 'ticket', id: ticket } }));
  const stepRuns = (phaseRunId: string) =>
    sql<StepRunRow>('SELECT id, step_id, state, failure, session_id, contrat_verdict, outputs FROM step_runs WHERE phase_run_id = $1 ORDER BY id', [phaseRunId]);
  const code = async (phaseRunId: string): Promise<StepRunRow> => {
    const found = (await stepRuns(phaseRunId)).find((run) => run.step_id === 'st-code');
    if (!found) throw new Error('No StepRun of st-code');
    return found;
  };
  const states = async (phaseRunId: string) => (await stepRuns(phaseRunId)).map((run) => `${run.step_id}:${run.state}`);
  const lastSeq = async () => Number((await sql<{ seq: string }>('SELECT seq::text FROM pilots WHERE id = $1', [alice.id]))[0]?.seq);
  const eventsSince = (seq: number) =>
    sql<{ type: string; payload: Record<string, unknown>; tx: string }>('SELECT type, payload, xmin::text AS tx FROM events WHERE pilot_id = $1 AND seq > $2 ORDER BY seq', [alice.id, seq]);
  const verdict = (status: 'passed' | 'incomplete', failedRuleIds: string[] = []) => ({ contractId: 'code', version: 1, status, failedRuleIds, warningRuleIds: [], headSha: SHA });

  /** A Ticket admitted with the Runner online: its st-code's Session started on it. */
  const started = async (ticket = '42') => {
    const socket = await online();
    const run = await admit(ticket);
    const start = await socket.expect('session.start');
    const stepRun = await code(run.id);
    return { socket, run, start, stepRun };
  };

  it('starts st-code’s Session with the Rôle’s Moteur and model in effect, its Skill, Contrat and Entrées, its id on the StepRun, the events in one transaction', async () => {
    const socket = await online();
    const before = await lastSeq();

    const run = await admit('42');

    const stepRun = await code(run.id);
    expect(stepRun).toMatchObject({ state: 'running', failure: null, contrat_verdict: null });
    expect(stepRun.session_id).not.toBeNull();
    const [session] = await sql<{ id: string; role: string; engine: string; model: string; step_run_id: string; state: string }>(
      'SELECT id, role, engine, model, step_run_id, state FROM agent_sessions WHERE pilot_id = $1',
      [alice.id],
    );
    expect(session).toEqual({ id: stepRun.session_id, role: 'code', engine: 'codex', model: 'gpt-5.5', step_run_id: stepRun.id, state: 'starting' });

    const events = await eventsSince(before);
    expect(events.map((event) => event.type)).toEqual(['phase-run.upserted', 'process.upserted', 'agent-session.upserted', 'step-run.upserted']);
    expect(new Set(events.map((event) => event.tx)).size).toBe(1);
    for (const event of events) expect(eventPayloadSchema(event.type as EventType)?.safeParse(event.payload).success).toBe(true);
    expect(events[3]?.payload).toMatchObject({ id: stepRun.id, sessionId: stepRun.session_id, contratVerdict: null });

    expect(await socket.expect('session.start')).toMatchObject({
      sessionId: stepRun.session_id,
      projectId,
      engine: 'codex',
      model: 'gpt-5.5',
      role: 'code',
      branch: 'feat/42-panier',
      title: 'Ticket #42',
      step: { stepRunId: stepRun.id, stepKind: 'code', skill: 'code', contractId: 'code', inputs: [{ portId: 'ticket', type: 'ticket', ref: { id: '42', number: 42 } }] },
      mcpServers: [],
    });
  });

  it('passes st-code on a passed verdict once its Session ended: its outputs, its contratVerdict, st-checks fed, onFinished once', async () => {
    const { socket, run, start, stepRun } = await started();

    socket.send({ type: 'step.started', stepRunId: stepRun.id });
    socket.send({ type: 'session.state', sessionId: start.sessionId, state: 'active' });
    socket.send({ type: 'step.verdict', stepRunId: stepRun.id, verdict: verdict('passed') });
    socket.send({ type: 'session.state', sessionId: start.sessionId, state: 'ended', outcome: 'ok' });

    await vi.waitFor(async () => expect((await code(run.id)).state).toBe('done'));
    expect(await code(run.id)).toMatchObject({ failure: null, contrat_verdict: verdict('passed'), outputs: [CHANGE] });
    expect(await states(run.id)).toEqual(['st-code:done', 'st-checks:running', 'st-rv:waiting']);
    expect(finished).toEqual([{ stepRunId: stepRun.id, finished: { status: 'passed', verdict: verdict('passed') } }]);
    const { stepRuns: slice } = await state();
    expect(slice.find((candidate: StepRun) => candidate.id === stepRun.id)).toMatchObject({ state: 'done', contratVerdict: verdict('passed'), sessionId: start.sessionId });
  });

  it('fails st-code contract-incomplete on an incomplete verdict, its failed rules kept, and session-error on a Session ended in error', async () => {
    const incomplete = await started('42');
    incomplete.socket.send({ type: 'step.verdict', stepRunId: incomplete.stepRun.id, verdict: verdict('incomplete', ['code.tests']) });
    incomplete.socket.send({ type: 'session.state', sessionId: incomplete.start.sessionId, state: 'ended', outcome: 'ok' });
    await vi.waitFor(async () => expect((await code(incomplete.run.id)).state).toBe('failed'));
    expect(await code(incomplete.run.id)).toMatchObject({ failure: 'contract-incomplete', contrat_verdict: verdict('incomplete', ['code.tests']) });
    expect(await states(incomplete.run.id)).toEqual(['st-code:failed']);

    const run = await admit('43');
    const start = await incomplete.socket.expect('session.start');
    incomplete.socket.send({ type: 'session.state', sessionId: start.sessionId, state: 'ended', outcome: 'error', error: 'engine-failed' });
    await vi.waitFor(async () => expect((await code(run.id)).state).toBe('failed'));
    expect((await code(run.id)).failure).toBe('session-error');

    expect(finished.map(({ finished: outcome }) => outcome)).toEqual([
      { status: 'incomplete', verdict: verdict('incomplete', ['code.tests']), failure: 'contract-incomplete' },
      { status: 'failed', failure: 'session-error' },
    ]);
  });

  it('keeps a valid report for the kind’s module; an invalid one fails st-code incomplete with report.schema once its Session ended, then its retry starts on the branch', async () => {
    const { socket, run, start, stepRun } = await started();
    const sealed = { key: Buffer.alloc(60, 0xd1).toString('base64url'), ciphertext: Buffer.alloc(48, 0xd2).toString('base64url') };

    socket.send({ type: 'step.report', stepRunId: stepRun.id, figures: { tests: 12 }, sealed, vaultKeyVersion: 1 });
    await vi.waitFor(() => expect(reports).toEqual([{ figures: { tests: 12 }, sealed }]));
    expect((await code(run.id)).state).toBe('running');

    socket.send({ type: 'step.report', stepRunId: stepRun.id, figures: { tests: 'douze' } });
    await vi.waitFor(async () => expect((await code(run.id)).contrat_verdict).toMatchObject({ status: 'incomplete', failedRuleIds: ['report.schema'] }));
    expect(await code(run.id)).toMatchObject({ state: 'running', failure: null });
    expect(finished).toEqual([]);
    expect(await inAlice((tx) => engine.retry(tx, stepRun.id))).toBeNull();

    socket.send({ type: 'step.verdict', stepRunId: stepRun.id, verdict: verdict('passed') });
    socket.send({ type: 'session.state', sessionId: start.sessionId, state: 'ended', outcome: 'ok' });
    await vi.waitFor(async () => expect((await code(run.id)).state).toBe('failed'));
    expect(await code(run.id)).toMatchObject({ failure: 'contract-incomplete', contrat_verdict: verdict('incomplete', ['report.schema']) });
    expect(finished.map(({ finished: outcome }) => outcome.status)).toEqual(['incomplete']);

    expect(await inAlice((tx) => engine.retry(tx, stepRun.id))).not.toBeNull();
    expect(await socket.expect('session.start')).toMatchObject({ branch: 'feat/42-panier', step: { stepKind: 'code' } });
  });

  it('interrupts st-code while its Session is stopped by the Pilote, and runs it again once resumed and active', async () => {
    const { socket, run, start } = await started();
    socket.send({ type: 'session.state', sessionId: start.sessionId, state: 'active' });
    await vi.waitFor(async () => expect((await sql<{ state: string }>('SELECT state FROM agent_sessions WHERE id = $1', [start.sessionId]))[0]?.state).toBe('active'));

    expect((await call('POST', `/api/sessions/${start.sessionId}/stop`, { seq: String((await state()).seq) })).status).toBe(200);
    expect(await code(run.id)).toMatchObject({ state: 'interrupted', failure: 'session-stopped' });

    expect((await call('POST', `/api/sessions/${start.sessionId}/resume`, { seq: String((await state()).seq) })).status).toBe(200);
    socket.send({ type: 'session.state', sessionId: start.sessionId, state: 'active' });
    await vi.waitFor(async () => expect(await code(run.id)).toMatchObject({ state: 'running', failure: null }));
  });

  it('lists the Projet as step-runs of « Runner hors ligne » while st-code’s Session waits for the Runner', async () => {
    const run = await admit('42');

    expect((await code(run.id)).state).toBe('running');
    const waiting = await runInPilotScope(alice.id, () => app.get(RunnerWaitingWork).collect(alice.id));
    expect(waiting).toEqual([{ projectId, name: expect.any(String), items: [{ kind: 'step-queued', count: 1 }] }]);

    const socket = await online();
    expect(await socket.expect('session.start')).toMatchObject({ step: { stepRunId: (await code(run.id)).id } });
  });
});
