import { type ArtifactRef, CATALOGUE, eventPayloadSchema, type EventType, type ProcessDefinition, type StepKind, zDecisionList, zProjectList, zState, zStepRunRerunResult } from '@crewdeck/contracts';
import { type INestApplication, Inject, Module, type OnModuleInit } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
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
import { Transactions, type Tx } from '../../src/realtime/transactions.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
import { deliverWebhook, TEST_WEBHOOK_SECRET, webhookFixture } from '../fakes/github.js';
import { connectRunner, type FakeRunnerClient } from '../fakes/runner.js';
import { authKeysEnv } from '../github-app.js';
import { expectEnvelope, expectFields, startApp } from '../route-baseline.js';

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

/** The other Étapes of « Développement », whose signal is their result: a test only watches them start. */
const OTHERS: readonly StepKind[] = ['checks', 'review', 'visual-review', 'merge'];
const other = (kind: StepKind): StepKindHandler => ({
  kind,
  start: () => Promise.resolve(CATALOGUE[kind].family === 'gate' ? 'waiting' : 'running'),
  onSignal: (_tx, _run, signal) => Promise.resolve(signal as StepResult | null),
});

/** « Code » as BOUCLE-3 will define it: its Contrat `code`, its change as output. */
@Module({ imports: [EngineModule, AgentStepsModule] })
class CodeKindModule implements OnModuleInit {
  constructor(
    @Inject(STEP_KIND_HANDLERS) private readonly handlers: StepKindHandlers,
    private readonly steps: AgentSteps,
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
  }
}

interface StepRunRow {
  id: string;
  step_id: string;
  state: string;
  iteration: number;
  failure: string | null;
}

interface DecisionRow {
  kind: string;
  project_id: string | null;
  project_name: string | null;
  subject_type: string;
  subject_id: string;
  label: string;
  meta_parts: string[];
  tone: string;
  link: string;
  params: Record<string, unknown>;
  state: string;
  outcome: string | null;
}

describe('« Contrat incomplet », « Étape échouée » and « Relancer l’Étape » against PostgreSQL', () => {
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

  afterAll(async () => {
    await app.close();
    await empty();
  });

  afterEach(async () => {
    await Promise.all(sockets.splice(0).map((socket) => socket.close()));
  });

  const pilot = async (githubUserId: number, login: string): Promise<{ id: string; cookie: string }> => {
    const id = newId();
    await sql(
      `WITH p AS (INSERT INTO pilots (id, display_name, time_zone, getting_started_step) VALUES ($1, $3, 'Europe/Paris', 'projects') RETURNING id) INSERT INTO pilot_identities (id, pilot_id, provider, subject, login) SELECT gen_random_uuid(), id, 'github', $2::text, $3 FROM p`,
      [id, githubUserId, login],
    );
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  const call = (method: 'GET' | 'POST', path: string, body?: unknown, cookie = alice.cookie): Promise<Response> =>
    fetch(`${url}${path}`, {
      method,
      headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const state = async () => zState.parse(await (await call('GET', '/api/state')).json());
  const lastSeq = async () => String((await sql<{ seq: string }>('SELECT seq::text FROM pilots WHERE id = $1', [alice.id]))[0]?.seq);

  beforeEach(async () => {
    await empty();
    fakes.github.reset();
    fakes.github.seedRepo({ ...APP_REPO, installationId: INSTALLATION_ID, files: { 'README.md': '# App' } });
    alice = await pilot(SENDER_ID, 'octo-fixture');
    expect((await deliverWebhook(url, { event: 'installation', payload: created })).status).toBe(202);
    await app.get(WebhookDispatcher).settled();
    const { seq, repositories } = await state();
    const followed = await call('POST', '/api/projects', { repositoryIds: repositories.map((repository) => repository.id), templateId: 'process-crewdeck', seq: String(seq) });
    expect(followed.status).toBe(201);
    projectId = zProjectList.parse(await followed.json()).items[0]?.id ?? '';
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
  const codeRuns = (phaseRunId: string) =>
    sql<StepRunRow>("SELECT id, step_id, state, iteration, failure FROM step_runs WHERE phase_run_id = $1 AND step_id = 'st-code' ORDER BY id", [phaseRunId]);
  const decisions = () =>
    sql<DecisionRow>(
      'SELECT kind, project_id, project_name, subject_type, subject_id, label, meta_parts, tone, link, params, state, outcome FROM decisions WHERE pilot_id = $1 ORDER BY created_at',
      [alice.id],
    );
  const eventsSince = (seq: string) =>
    sql<{ type: string; payload: Record<string, unknown>; tx: string }>('SELECT type, payload, xmin::text AS tx FROM events WHERE pilot_id = $1 AND seq > $2 ORDER BY seq', [alice.id, seq]);
  const openInAToi = async () => zDecisionList.parse(await (await call('GET', '/api/decisions?state=open')).json()).items;
  const verdict = (status: 'passed' | 'incomplete', failedRuleIds: string[] = []) => ({ contractId: 'code', version: 1, status, failedRuleIds, warningRuleIds: [], headSha: SHA });

  /** A Ticket admitted with the Runner online: its st-code's Session started on it. */
  const started = async (ticket = '42', socket?: FakeRunnerClient) => {
    const runner = socket ?? (await online());
    const run = await admit(ticket);
    const start = await runner.expect('session.start');
    const [stepRun] = await codeRuns(run.id);
    if (!stepRun) throw new Error('No StepRun of st-code');
    return { socket: runner, run, start, stepRun };
  };

  /** st-code's Session ends after the Runner checked its Contrat: `incomplete` with `failedRuleIds`, or `passed`. */
  const endWith = (socket: FakeRunnerClient, stepRunId: string, sessionId: string, failedRuleIds: string[] | null) => {
    socket.send({ type: 'step.verdict', stepRunId, verdict: failedRuleIds ? verdict('incomplete', failedRuleIds) : verdict('passed') });
    socket.send({ type: 'session.state', sessionId, state: 'ended', outcome: 'ok' });
  };

  const incomplete = async (ticket = '42') => {
    const run = await started(ticket);
    endWith(run.socket, run.stepRun.id, run.start.sessionId, ['code.tests', 'code.lint', 'code.pr']);
    await vi.waitFor(async () => expect((await codeRuns(run.run.id))[0]?.state).toBe('failed'));
    return run;
  };

  it('raises one « Contrat incomplet » on an incomplete verdict, in « À toi » within 2 s, its row holding ids, the Étape’s and Phase’s names only', async () => {
    const { socket, run, start, stepRun } = await started();
    const ended = Date.now();
    endWith(socket, stepRun.id, start.sessionId, ['code.tests', 'code.lint', 'code.pr']);

    await vi.waitFor(async () => expect(await openInAToi()).toHaveLength(1), { timeout: 2000, interval: 50 });
    expect(Date.now() - ended).toBeLessThan(2000);
    expect(await decisions()).toEqual([
      {
        kind: 'contract-incomplete',
        project_id: projectId,
        project_name: expect.any(String),
        subject_type: 'step-run',
        subject_id: stepRun.id,
        label: 'Code',
        meta_parts: ['Développement'],
        tone: 'caution',
        link: `/projets/${projectId}`,
        params: {
          stepRunId: stepRun.id,
          phaseRunId: run.id,
          stepId: 'st-code',
          itemType: 'ticket',
          itemId: '42',
          itemLabelled: false,
          contractId: 'code',
          contractVersion: 1,
          failedRuleIds: 'code.tests,code.lint,code.pr',
          failedCount: 3,
        },
        state: 'open',
        outcome: null,
      },
    ]);
  });

  it('names the Étape as the PhaseRun’s pinned version does: « Code du front » once renamed', async () => {
    const [active] = await sql<{ definition: ProcessDefinition }>('SELECT definition FROM process_versions WHERE project_id = $1 ORDER BY number DESC LIMIT 1', [projectId]);
    if (!active) throw new Error('No version');
    const renamed = { ...active.definition, steps: active.definition.steps.map((step) => (step.id === 'st-code' ? { ...step, name: 'Code du front' } : step)) };
    await sql(
      `INSERT INTO process_versions (id, pilot_id, project_id, number, definition, activated_at, activated_by)
       SELECT $1, $2, $3, max(number) + 1, $4, now(), 'pilot' FROM process_versions WHERE project_id = $3`,
      [newId(), alice.id, projectId, JSON.stringify(renamed)],
    );

    await incomplete();

    expect((await decisions()).map((decision) => decision.label)).toEqual(['Code du front']);
  });

  it('raises « Étape échouée » on a Session ended in error, and nothing on a Session stopped by the Pilote', async () => {
    const failed = await started('42');
    failed.socket.send({ type: 'session.state', sessionId: failed.start.sessionId, state: 'ended', outcome: 'error', error: 'engine-failed' });
    await vi.waitFor(async () => expect((await codeRuns(failed.run.id))[0]?.state).toBe('failed'));
    expect(await decisions()).toMatchObject([
      {
        kind: 'step-failed',
        subject_type: 'step-run',
        subject_id: failed.stepRun.id,
        label: 'Code',
        meta_parts: ['Développement'],
        params: { stepRunId: failed.stepRun.id, phaseRunId: failed.run.id, stepId: 'st-code', itemType: 'ticket', itemId: '42', failure: 'session-error' },
        state: 'open',
      },
    ]);

    const stopped = await started('43', failed.socket);
    stopped.socket.send({ type: 'session.state', sessionId: stopped.start.sessionId, state: 'active' });
    await vi.waitFor(async () => expect((await sql<{ state: string }>('SELECT state FROM agent_sessions WHERE id = $1', [stopped.start.sessionId]))[0]?.state).toBe('active'));
    expect((await call('POST', `/api/sessions/${stopped.start.sessionId}/stop`, { seq: String((await state()).seq) })).status).toBe(200);
    expect((await codeRuns(stopped.run.id))[0]).toMatchObject({ state: 'interrupted', failure: 'session-stopped' });
    expect((await decisions()).map((decision) => decision.subject_id)).toEqual([failed.stepRun.id]);
  });

  it('« Relancer l’Étape »: a new StepRun of the same Étape and iteration in the same PhaseRun, its Session started, the Décision out of « À toi »; a second click 409', async () => {
    const { socket, run, stepRun } = await incomplete();

    const response = await call('POST', `/api/step-runs/${stepRun.id}/rerun`, { seq: await lastSeq() });

    expect(response.status).toBe(200);
    const rerun = zStepRunRerunResult.parse(await response.json()).stepRun;
    expect(rerun).toMatchObject({ phaseRunId: run.id, stepId: 'st-code', iteration: stepRun.iteration, state: 'running' });
    expect(rerun?.id).not.toBe(stepRun.id);
    expect((await codeRuns(run.id)).map((candidate) => `${candidate.state}:${candidate.iteration}`)).toEqual(['failed:1', 'running:1']);
    expect(await socket.expect('session.start')).toMatchObject({ step: { stepRunId: rerun?.id } });
    expect(await openInAToi()).toEqual([]);
    expect(await decisions()).toMatchObject([{ kind: 'contract-incomplete', state: 'resolved', outcome: 'rerun' }]);

    const again = await call('POST', `/api/step-runs/${stepRun.id}/rerun`, { seq: await lastSeq() });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: 'decision.already-answered' });
  });

  it('refuses to rerun a done StepRun (422), another Pilote’s or an unknown one (404), and on a stale seq (409)', async () => {
    const passed = await started('42');
    endWith(passed.socket, passed.stepRun.id, passed.start.sessionId, null);
    await vi.waitFor(async () => expect((await codeRuns(passed.run.id))[0]?.state).toBe('done'));
    const done = await call('POST', `/api/step-runs/${passed.stepRun.id}/rerun`, { seq: await lastSeq() });
    expect(done.status).toBe(422);
    expect(await done.json()).toMatchObject({ code: 'step.not-rerunnable', message: 'Cette Étape ne peut pas être relancée.' });

    const failed = await started('43', passed.socket);
    endWith(failed.socket, failed.stepRun.id, failed.start.sessionId, ['code.tests']);
    await vi.waitFor(async () => expect((await codeRuns(failed.run.id))[0]?.state).toBe('failed'));

    const bob = await pilot(SENDER_ID + 1, 'bob-fixture');
    const asBob = await call('POST', `/api/step-runs/${failed.stepRun.id}/rerun`, { seq: await lastSeq() }, bob.cookie);
    expect(asBob.status).toBe(404);
    expect(await asBob.json()).toMatchObject({ code: 'step-run.not-found' });
    expect((await call('POST', `/api/step-runs/${newId()}/rerun`, { seq: await lastSeq() })).status).toBe(404);

    const stale = await call('POST', `/api/step-runs/${failed.stepRun.id}/rerun`, { seq: '1' });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'realtime.stale' });
    expect((await decisions()).filter((decision) => decision.state === 'open')).toHaveLength(1);
  });

  it('resolves an open « Contrat incomplet » once a later StepRun of the same PhaseRun and Étape passes', async () => {
    const { socket, run, stepRun } = await incomplete();
    const restarted = await inAlice((tx) => engine.retry(tx, stepRun.id));
    if (!restarted || restarted === 'held') throw new Error('Not restarted');
    const start = await socket.expect('session.start');
    expect(await decisions()).toMatchObject([{ state: 'open' }]);

    endWith(socket, restarted.id, start.sessionId, null);

    await vi.waitFor(async () => expect((await codeRuns(run.id)).map((candidate) => candidate.state)).toEqual(['failed', 'done']));
    expect(await decisions()).toMatchObject([{ kind: 'contract-incomplete', subject_id: stepRun.id, state: 'resolved', outcome: 'passed' }]);
    expect(await openInAToi()).toEqual([]);
  });

  it('writes each change with its events in one transaction, their payloads per their schemas; 400 without seq, 401 without a session', async () => {
    const { socket, run, start, stepRun } = await started();
    const before = await lastSeq();
    endWith(socket, stepRun.id, start.sessionId, ['code.tests']);
    await vi.waitFor(async () => expect((await codeRuns(run.id))[0]?.state).toBe('failed'));
    const since = await eventsSince(before);
    const raisedTx = since.find((event) => event.type === 'decision.upserted')?.tx;
    const failing = since.filter((event) => event.tx === raisedTx);
    expect(failing.map((event) => event.type)).toEqual(expect.arrayContaining(['decision.upserted', 'step-run.upserted']));
    expect(failing.find((event) => event.type === 'step-run.upserted')?.payload).toMatchObject({ id: stepRun.id, state: 'failed', failure: 'contract-incomplete' });

    await expectFields(await call('POST', `/api/step-runs/${stepRun.id}/rerun`, {}), ['seq']);
    const anonymous = await fetch(`${url}/api/step-runs/${stepRun.id}/rerun`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ seq: await lastSeq() }) });
    await expectEnvelope(anonymous, 401, 'auth.required');

    const answered = await lastSeq();
    expect((await call('POST', `/api/step-runs/${stepRun.id}/rerun`, { seq: answered })).status).toBe(200);
    const events = await eventsSince(answered);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['decision.removed', 'step-run.upserted', 'phase-run.upserted']));
    const answerTx = events.find((event) => event.type === 'decision.removed')?.tx;
    expect(events.filter((event) => event.tx === answerTx).map((event) => event.type)).toContain('step-run.upserted');
    for (const event of [...failing, ...events]) expect(eventPayloadSchema(event.type as EventType)?.safeParse(event.payload).success).toBe(true);
  });
});
