import {
  type ArtifactRef,
  CATALOGUE,
  eventPayloadSchema,
  type EventType,
  PROCESS_CREWDECK,
  type ProcessDefinition,
  type StepKind,
  zProjectList,
  zState,
} from '@crewdeck/contracts';
import { type INestApplication, Inject, Module, type OnModuleInit } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { createApp } from '../../src/app.js';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { WebhookDispatcher } from '../../src/github/webhooks/dispatcher.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { DuplicateStartGuardError, Engine, type StartGuard } from '../../src/process/engine/engine.js';
import { EngineModule } from '../../src/process/engine/engine.module.js';
import { DuplicateStepKindHandlerError, STEP_KIND_HANDLERS, type StepKindHandler, type StepKindHandlers, type StepResult } from '../../src/process/engine/kinds/handler.js';
import { Transactions, type Tx } from '../../src/realtime/transactions.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import { deliverWebhook, TEST_WEBHOOK_SECRET, webhookFixture } from '../fakes/github.js';
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

/**
 * What the test handlers did: each `stop`, by Étape. Their `onSignal` gives
 * back the signal as the result: a test says what the Étape's thing ended
 * with.
 */
const stops: string[] = [];
/** The kinds the test handlers take: « Développement » of « Process Crewdeck », its gate « Revue visuelle » waiting on the Pilote. */
const HANDLED: readonly StepKind[] = ['code', 'checks', 'review', 'visual-review', 'merge'];
const handler = (kind: StepKind): StepKindHandler => ({
  kind,
  start: () => Promise.resolve(CATALOGUE[kind].family === 'gate' ? 'waiting' : 'running'),
  onSignal: (_tx, _run, signal) => Promise.resolve(signal as StepResult | null),
  stop: (_tx, run) => {
    stops.push(run.step.id);
    return Promise.resolve();
  },
});

/** The start guard of `ticket.ready`, as BOUCLE-2's will be: `held` lets only the gates and `merge` through. */
let held = false;
const guard: StartGuard = (_tx, { kind }) => Promise.resolve(!held || CATALOGUE[kind].family === 'gate' || kind === 'merge');

@Module({ imports: [EngineModule] })
class TestHandlersModule implements OnModuleInit {
  constructor(
    @Inject(STEP_KIND_HANDLERS) private readonly handlers: StepKindHandlers,
    private readonly engine: Engine,
  ) {}

  onModuleInit(): void {
    for (const kind of HANDLED) this.handlers.add(handler(kind));
    this.engine.registerStartGuard('ticket.ready', guard);
  }
}

@Module({ imports: [EngineModule] })
class SecondCodeHandlerModule implements OnModuleInit {
  constructor(@Inject(STEP_KIND_HANDLERS) private readonly handlers: StepKindHandlers) {}

  onModuleInit(): void {
    this.handlers.add(handler('code'));
  }
}

@Module({ imports: [EngineModule] })
class SecondGuardModule implements OnModuleInit {
  constructor(private readonly engine: Engine) {}

  onModuleInit(): void {
    this.engine.registerStartGuard('ticket.ready', guard);
  }
}

interface StepRunRow {
  id: string;
  step_id: string;
  state: string;
  iteration: number;
  reason: string | null;
  failure: string | null;
  inputs: { portId: string; artifacts: ArtifactRef[] }[];
}

interface EventRow {
  type: string;
  payload: Record<string, unknown>;
  tx: string;
}

const CHANGE: ArtifactRef = { portId: 'changement', type: 'code-change', id: '57', sha: 'a'.repeat(40) };
const NEW_CHANGE: ArtifactRef = { ...CHANGE, sha: 'b'.repeat(40) };
const verdict = (id: string): ArtifactRef => ({ portId: 'verdict', type: 'verdict', id });
const done = (outputs: ArtifactRef[], verdictOf?: 'passed' | 'changes'): StepResult => ({ state: 'done', outputs, ...(verdictOf ? { verdict: verdictOf } : {}) });

describe('the engine against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let fakes: Fakes;
  let engine: Engine;
  let alice: { id: string; cookie: string };
  let projectId: string;

  beforeAll(async () => {
    ({ app, url } = await startApp(env, { imports: [TestHandlersModule] }));
    prisma = app.get(PrismaService);
    fakes = app.get<Fakes>(FAKES);
    engine = app.get(Engine);
  });

  const empty = () => sql('TRUNCATE pilots, github_installations, github_deliveries CASCADE');

  afterAll(async () => {
    await empty();
    await app.close();
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
    stops.length = 0;
    held = false;
    fakes.github.reset();
    fakes.github.seedRepo({ ...APP_REPO, installationId: INSTALLATION_ID, files: { 'README.md': '# App' } });
    const id = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone, getting_started_step) VALUES ($1, $2, 'octo-fixture', 'Europe/Paris', 'projects')`, [id, SENDER_ID]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    alice = { id, cookie: `${SESSION_COOKIE}=${token}` };
    // Alice follows the fixture's repository: her Projet, its version 1 « Process Crewdeck ».
    expect((await deliverWebhook(url, { event: 'installation', payload: created })).status).toBe(202);
    await app.get(WebhookDispatcher).settled();
    const { seq, repositories } = await state();
    const followed = await call('POST', '/api/projects', { repositoryIds: repositories.map((repository) => repository.id), seq: String(seq) });
    expect(followed.status).toBe(201);
    projectId = zProjectList.parse(await followed.json()).items[0]?.id ?? '';
  });

  const inAlice = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => runInPilotScope(alice.id, () => app.get(Transactions).run(fn));
  const admit = (ticket: string, phaseId = 'ph-dev') => inAlice((tx) => engine.admit(tx, { projectId, phaseId, item: { type: 'ticket', id: ticket } }));
  const stepRuns = (phaseRunId: string) =>
    sql<StepRunRow>('SELECT id, step_id, state, iteration, reason, failure, inputs FROM step_runs WHERE phase_run_id = $1 ORDER BY id', [phaseRunId]);
  const states = async (phaseRunId: string) => (await stepRuns(phaseRunId)).map((run) => `${run.step_id}:${run.state}`);
  /** The latest StepRun of `stepId`. */
  const stepRun = async (phaseRunId: string, stepId: string): Promise<StepRunRow> => {
    const found = (await stepRuns(phaseRunId)).filter((run) => run.step_id === stepId).at(-1);
    if (!found) throw new Error(`No StepRun of ${stepId}`);
    return found;
  };
  const signal = async (phaseRunId: string, stepId: string, result: StepResult) => inAlice(async (tx) => engine.signal(tx, (await stepRun(phaseRunId, stepId)).id, result));
  const phaseRunState = async (phaseRunId: string) => (await sql<{ state: string }>('SELECT state FROM phase_runs WHERE id = $1', [phaseRunId]))[0]?.state;
  const eventsSince = (seq: number) =>
    sql<EventRow>('SELECT type, payload, xmin::text AS tx FROM events WHERE pilot_id = $1 AND seq > $2 ORDER BY seq', [alice.id, seq]);
  const lastSeq = async () => Number((await sql<{ seq: string }>('SELECT seq::text FROM pilots WHERE id = $1', [alice.id]))[0]?.seq);

  /** A version written beside the active one, as PROCESS-10's activation will: the next number. */
  const writeVersion = async (definition: ProcessDefinition): Promise<void> => {
    await sql(
      `INSERT INTO process_versions (id, pilot_id, project_id, number, definition, activated_at, activated_by)
       SELECT $1, $2, $3, max(number) + 1, $4, now(), 'pilot' FROM process_versions WHERE project_id = $3`,
      [newId(), alice.id, projectId, JSON.stringify(definition)],
    );
  };

  /** A Ticket through « Développement » up to `st-merge` running. */
  const upToMerge = async (ticket = '42') => {
    const run = await admit(ticket);
    await signal(run.id, 'st-code', done([CHANGE]));
    await signal(run.id, 'st-checks', done([verdict('v-checks')], 'passed'));
    await signal(run.id, 'st-review', done([verdict('v-review')], 'passed'));
    await signal(run.id, 'st-rv', done([verdict('v-rv')], 'passed'));
    return run;
  };

  it('admits a Ticket into « Développement »: a running PhaseRun pinned to the active version, st-code started on the Ticket, the events in the transaction', async () => {
    const before = await lastSeq();

    const run = await admit('42');

    expect(run).toMatchObject({ projectId, processVersion: 1, phaseId: 'ph-dev', itemType: 'ticket', itemId: '42', state: 'running', waitingOn: null, endedAt: null });
    const [code] = await stepRuns(run.id);
    expect(await states(run.id)).toEqual(['st-code:running']);
    expect(code).toMatchObject({ iteration: 1, reason: null, failure: null, inputs: [{ portId: 'ticket', artifacts: [{ portId: 'ticket', type: 'ticket', id: '42' }] }] });

    const events = await eventsSince(before);
    expect(events.map((event) => event.type)).toEqual(['phase-run.upserted', 'step-run.upserted']);
    expect(new Set(events.map((event) => event.tx)).size).toBe(1);
    for (const event of events) expect(eventPayloadSchema(event.type as EventType)?.safeParse(event.payload).success).toBe(true);
    expect(events[1]?.payload).toMatchObject({ id: code?.id, phaseRunId: run.id, stepId: 'st-code', kind: 'code', state: 'running' });
  });

  it('writes nothing when the caller’s transaction rolls back', async () => {
    const before = await lastSeq();

    await expect(
      inAlice(async (tx) => {
        await engine.admit(tx, { projectId, phaseId: 'ph-dev', item: { type: 'ticket', id: '42' } });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await sql('SELECT id FROM phase_runs')).toEqual([]);
    expect(await eventsSince(before)).toEqual([]);
  });

  it('refuses a Phase that does not exist and an item of another type than its forEach’s', async () => {
    await expect(admit('42', 'ph-nowhere')).rejects.toThrow(/no Phase ph-nowhere/);
    await expect(inAlice((tx) => engine.admit(tx, { projectId, phaseId: 'ph-dev', item: { type: 'idea', id: 'idee-1' } }))).rejects.toThrow(/does not repeat for idea/);
    expect(await inAlice((tx) => engine.phaseFor(tx, projectId, 'ticket.ready'))).toBe('ph-dev');
  });

  it('feeds « Développement » to the end: st-checks and st-rv after st-code, st-review after the checks, st-merge after both Verdicts, then done', async () => {
    const run = await admit('42');

    await signal(run.id, 'st-code', done([CHANGE]));
    expect(await states(run.id)).toEqual(['st-code:done', 'st-checks:running', 'st-rv:waiting']);
    expect((await stepRun(run.id, 'st-checks')).inputs).toEqual([{ portId: 'changement', artifacts: [CHANGE] }]);

    await signal(run.id, 'st-checks', done([verdict('v-checks')], 'passed'));
    expect(await states(run.id)).toEqual(['st-code:done', 'st-checks:done', 'st-rv:waiting', 'st-review:running']);

    await signal(run.id, 'st-review', done([verdict('v-review')], 'passed'));
    expect(await states(run.id)).not.toContain('st-merge:running');

    await signal(run.id, 'st-rv', done([verdict('v-rv')], 'passed'));
    expect((await stepRun(run.id, 'st-merge')).inputs).toEqual([
      { portId: 'changement', artifacts: [CHANGE] },
      { portId: 'v-review', artifacts: [verdict('v-review')] },
      { portId: 'v-rv', artifacts: [verdict('v-rv')] },
    ]);

    expect(await signal(run.id, 'st-merge', done([{ ...CHANGE, sha: 'c'.repeat(40) }]))).toBe(true);
    expect(await phaseRunState(run.id)).toBe('done');
    expect(await states(run.id)).toEqual(['st-code:done', 'st-checks:done', 'st-rv:done', 'st-review:done', 'st-merge:done']);
    expect(await signal(run.id, 'st-merge', done([]))).toBe(false);
  });

  it('keeps a running PhaseRun on version 1 to its end when a version 2 is written; the next admission takes version 2', async () => {
    const run = await admit('42');
    const withoutVisualReview: ProcessDefinition = {
      ...PROCESS_CREWDECK,
      steps: PROCESS_CREWDECK.steps.filter((step) => step.id !== 'st-rv').map((step) => (step.id === 'st-merge' ? { ...step, inputs: step.inputs.filter((port) => port.id !== 'v-rv') } : step)),
      arrows: PROCESS_CREWDECK.arrows.filter((arrow) => arrow.from.stepId !== 'st-rv' && arrow.to.stepId !== 'st-rv'),
      loopBacks: PROCESS_CREWDECK.loopBacks.filter((loopBack) => loopBack.from !== 'st-rv'),
    };
    await writeVersion(withoutVisualReview);

    await signal(run.id, 'st-code', done([CHANGE]));
    expect(await states(run.id)).toEqual(['st-code:done', 'st-checks:running', 'st-rv:waiting']);

    const next = await admit('43');
    expect(next.processVersion).toBe(2);
    await signal(next.id, 'st-code', done([CHANGE]));
    expect(await states(next.id)).toEqual(['st-code:done', 'st-checks:running']);

    await signal(run.id, 'st-checks', done([verdict('v-checks')], 'passed'));
    await signal(run.id, 'st-review', done([verdict('v-review')], 'passed'));
    await signal(run.id, 'st-rv', done([verdict('v-rv')], 'passed'));
    await signal(run.id, 'st-merge', done([CHANGE]));
    expect(await sql('SELECT p.state, v.number FROM phase_runs p JOIN process_versions v ON v.id = p.process_version_id WHERE p.id = $1', [run.id])).toEqual([
      { state: 'done', number: 1 },
    ]);
  });

  it('returns the unfinished PhaseRun on a second admission even when the active version no longer has its Phase', async () => {
    const run = await admit('42');
    const rename = (phaseId: string) => (phaseId === 'ph-dev' ? 'ph-build' : phaseId);
    await writeVersion({
      ...PROCESS_CREWDECK,
      phases: PROCESS_CREWDECK.phases.map((phase) => ({ ...phase, id: rename(phase.id) })),
      steps: PROCESS_CREWDECK.steps.map((step) => ({ ...step, phaseId: rename(step.phaseId) })),
    });

    expect(await admit('42')).toEqual(run);
    await expect(admit('43')).rejects.toThrow(/no Phase ph-dev/);
  });

  it('returns the unfinished PhaseRun on a second admission, and a new one once it is finished', async () => {
    const first = await admit('42');

    expect(await admit('42')).toEqual(first);
    expect(await sql('SELECT id FROM phase_runs')).toEqual([{ id: first.id }]);
    await expect(
      sql(`INSERT INTO phase_runs (id, pilot_id, project_id, process_version_id, phase_id, item_type, item_id, state, started_at)
           SELECT $1, pilot_id, project_id, process_version_id, phase_id, item_type, item_id, 'running', now() FROM phase_runs WHERE id = $2`, [newId(), first.id]),
    ).rejects.toThrow(/phase_runs_project_id_phase_id_item_unfinished_key/);

    await inAlice((tx) => engine.stop(tx, first.id));
    const second = await admit('42');
    expect(second.id).not.toBe(first.id);
  });

  it('applies two signals at once on one PhaseRun one after the other: st-merge starts once', async () => {
    const run = await admit('42');
    await signal(run.id, 'st-code', done([CHANGE]));
    await signal(run.id, 'st-checks', done([verdict('v-checks')], 'passed'));
    const review = await stepRun(run.id, 'st-review');
    const rv = await stepRun(run.id, 'st-rv');

    const applied = await Promise.all([
      inAlice((tx) => engine.signal(tx, review.id, done([verdict('v-review')], 'passed'))),
      inAlice((tx) => engine.signal(tx, rv.id, done([verdict('v-rv')], 'passed'))),
    ]);

    expect(applied).toEqual([true, true]);
    expect((await stepRuns(run.id)).filter((candidate) => candidate.step_id === 'st-merge').map((candidate) => candidate.state)).toEqual(['running']);
  });

  it('makes the PhaseRun failed on a failed Étape once nothing runs; retry starts a new StepRun of that Étape and iteration, the PhaseRun running again', async () => {
    const run = await admit('42');
    await signal(run.id, 'st-code', done([CHANGE]));
    await signal(run.id, 'st-checks', { state: 'failed', failure: 'checks-failed' });
    expect(await phaseRunState(run.id)).toBe('running');

    await signal(run.id, 'st-rv', done([verdict('v-rv')], 'passed'));
    expect(await phaseRunState(run.id)).toBe('failed');
    const failed = await stepRun(run.id, 'st-checks');
    expect(failed).toMatchObject({ state: 'failed', failure: 'checks-failed' });

    const retried = await inAlice((tx) => engine.retry(tx, failed.id));

    expect(retried).toMatchObject({ stepId: 'st-checks', iteration: 1, state: 'running', inputs: failed.inputs });
    expect(await phaseRunState(run.id)).toBe('running');
    expect(await inAlice((tx) => engine.retry(tx, failed.id))).toBeNull();

    await signal(run.id, 'st-checks', done([verdict('v-checks')], 'passed'));
    await signal(run.id, 'st-review', done([verdict('v-review')], 'passed'));
    await signal(run.id, 'st-merge', done([CHANGE]));
    expect(await phaseRunState(run.id)).toBe('done');
  });

  it('publishes again every StepRun of a failed PhaseRun a retry reopens, after the PhaseRun: what a page dropped comes back', async () => {
    const run = await admit('42');
    await signal(run.id, 'st-code', { state: 'failed', failure: 'agent-failed' });
    const failed = await stepRun(run.id, 'st-code');
    const before = await lastSeq();

    await inAlice((tx) => engine.retry(tx, failed.id));

    const events = await eventsSince(before);
    expect(events.map((event) => [event.type, event.payload['stepId'] ?? event.payload['state']])).toEqual([
      ['phase-run.upserted', 'running'],
      ['step-run.upserted', 'st-code'],
      ['step-run.upserted', 'st-code'],
    ]);
    expect(events[1]?.payload).toMatchObject({ id: failed.id, state: 'failed' });
    expect(events[2]?.payload).toMatchObject({ state: 'running', iteration: 1 });
  });

  it('asks the start guard on a retry: held, the PhaseRun running and the Étape ready, until startQueued starts it at the same iteration', async () => {
    const run = await admit('42');
    await signal(run.id, 'st-code', { state: 'failed', failure: 'agent-failed' });
    const failed = await stepRun(run.id, 'st-code');
    held = true;

    expect(await inAlice((tx) => engine.retry(tx, failed.id))).toBe('held');

    expect(await phaseRunState(run.id)).toBe('running');
    expect(await states(run.id)).toEqual(['st-code:failed']);
    expect(await inAlice((tx) => engine.retry(tx, failed.id))).toBeNull();
    await inAlice((tx) => engine.startQueued(tx, projectId));
    expect(await states(run.id)).toEqual(['st-code:failed']);

    held = false;
    await inAlice((tx) => engine.startQueued(tx, projectId));

    expect(await states(run.id)).toEqual(['st-code:failed', 'st-code:running']);
    expect(await stepRun(run.id, 'st-code')).toMatchObject({ iteration: 1, inputs: failed.inputs });
    await signal(run.id, 'st-code', done([CHANGE]));
    expect(await states(run.id)).toEqual(['st-code:failed', 'st-code:done', 'st-checks:running', 'st-rv:waiting']);
  });

  it('refuses the retry of a failed PhaseRun whose item went through the Phase again since, writing nothing', async () => {
    const first = await admit('42');
    await signal(first.id, 'st-code', { state: 'failed', failure: 'agent-failed' });
    const failed = await stepRun(first.id, 'st-code');
    const second = await admit('42');
    expect(second.id).not.toBe(first.id);
    const before = await lastSeq();

    expect(await inAlice((tx) => engine.retry(tx, failed.id))).toBeNull();

    expect(await phaseRunState(first.id)).toBe('failed');
    expect(await states(first.id)).toEqual(['st-code:failed']);
    expect(await eventsSince(before)).toEqual([]);
  });

  it('fails an Étape whose kind has no handler with no-handler, and its PhaseRun', async () => {
    const [code] = PROCESS_CREWDECK.steps.filter((step) => step.id === 'st-code');
    await writeVersion({ ...PROCESS_CREWDECK, steps: PROCESS_CREWDECK.steps.map((step) => (step === code ? { ...step, kind: 'command' } : step)) });

    const run = await admit('42');

    expect(await stepRuns(run.id)).toEqual([expect.objectContaining({ step_id: 'st-code', state: 'failed', failure: 'no-handler' })]);
    expect(await phaseRunState(run.id)).toBe('failed');
  });

  it('stops every open StepRun through its handler, then the PhaseRun', async () => {
    const run = await admit('42');
    await signal(run.id, 'st-code', done([CHANGE]));

    const stopped = await inAlice((tx) => engine.stop(tx, run.id));

    expect(stopped.state).toBe('stopped');
    expect(stops.sort()).toEqual(['st-checks', 'st-rv']);
    expect(await states(run.id)).toEqual(['st-code:done', 'st-checks:stopped', 'st-rv:stopped']);
    expect(await signal(run.id, 'st-checks', done([]))).toBe(false);
  });

  it('keeps the PhaseRun open on an interrupted or blocked result; a later running result resumes the StepRun', async () => {
    const run = await admit('42');

    await signal(run.id, 'st-code', { state: 'interrupted', failure: 'runner-offline' });
    expect(await stepRun(run.id, 'st-code')).toMatchObject({ state: 'interrupted', failure: 'runner-offline' });
    expect(await phaseRunState(run.id)).toBe('running');

    await signal(run.id, 'st-code', { state: 'running' });
    expect(await stepRun(run.id, 'st-code')).toMatchObject({ state: 'running', failure: null });

    await signal(run.id, 'st-code', { state: 'blocked', failure: 'agent-blocked' });
    expect(await phaseRunState(run.id)).toBe('running');
    await signal(run.id, 'st-code', { state: 'running' });
    await signal(run.id, 'st-code', done([CHANGE]));
    expect(await states(run.id)).toEqual(['st-code:done', 'st-checks:running', 'st-rv:waiting']);
  });

  it('reruns from st-code with fix-conflict: every StepRun from it on superseded, st-code at iteration 2 with that reason, the Étapes after it on its new outputs', async () => {
    const run = await upToMerge();
    expect(await states(run.id)).toContain('st-merge:running');

    const rerun = await inAlice((tx) => engine.rerunFrom(tx, run.id, 'st-code', { reason: 'fix-conflict' }));

    expect(rerun).toMatchObject({ stepId: 'st-code', iteration: 2, reason: 'fix-conflict', state: 'running' });
    expect(stops).toEqual(['st-merge']);
    expect(await states(run.id)).toEqual([
      'st-code:superseded',
      'st-checks:superseded',
      'st-rv:superseded',
      'st-review:superseded',
      'st-merge:superseded',
      'st-code:running',
    ]);

    await signal(run.id, 'st-code', done([NEW_CHANGE]));
    const checks = await stepRun(run.id, 'st-checks');
    expect(checks).toMatchObject({ state: 'running', iteration: 2, reason: null, inputs: [{ portId: 'changement', artifacts: [NEW_CHANGE] }] });
    expect((await stepRun(run.id, 'st-rv')).iteration).toBe(2);
    // No Retour was taken: only the caller's reason names this rerun.
    expect((await stepRuns(run.id)).map((candidate) => candidate.reason).filter((reason) => reason !== null)).toEqual(['fix-conflict']);
  });

  it('asks the start guard on a rerun: held, every StepRun from st-code superseded, until startQueued starts st-code at iteration 2 with its reason', async () => {
    const run = await upToMerge();
    held = true;

    expect(await inAlice((tx) => engine.rerunFrom(tx, run.id, 'st-code', { reason: 'fix-conflict' }))).toBe('held');

    expect(await phaseRunState(run.id)).toBe('running');
    expect((await stepRuns(run.id)).every((candidate) => candidate.state === 'superseded')).toBe(true);

    held = false;
    await inAlice((tx) => engine.startQueued(tx, projectId));

    expect(await stepRun(run.id, 'st-code')).toMatchObject({ state: 'running', iteration: 2, reason: 'fix-conflict' });
    await signal(run.id, 'st-code', done([NEW_CHANGE]));
    expect(await stepRun(run.id, 'st-checks')).toMatchObject({ state: 'running', iteration: 2, reason: null });
  });

  it('refuses rerunFrom on a finished PhaseRun', async () => {
    const run = await admit('42');
    await inAlice((tx) => engine.stop(tx, run.id));

    await expect(inAlice((tx) => engine.rerunFrom(tx, run.id, 'st-code', { reason: 'fix-conflict' }))).rejects.toThrow(/stopped/);
  });

  it('holds a second Ticket’s st-code ready and unstarted while the guard refuses it, lets the gates and merge through, and startQueued starts it once the guard accepts', async () => {
    const first = await upToMerge('42');
    held = true;

    const second = await admit('43');
    expect(second.state).toBe('running');
    expect(await stepRuns(second.id)).toEqual([]);
    expect(await states(first.id)).toContain('st-merge:running');

    held = false;
    await inAlice((tx) => engine.startQueued(tx, projectId));

    expect(await states(second.id)).toEqual(['st-code:running']);
  });

  it('throws at start on a second handler for one kind, and on a second guard for one forEach', async () => {
    const boot = async (second: typeof SecondCodeHandlerModule | typeof SecondGuardModule) => {
      const duplicate = await createApp(env, { logs: false, imports: [TestHandlersModule, second] });
      try {
        await duplicate.init();
      } finally {
        await duplicate.close().catch(() => undefined);
      }
    };
    await expect(boot(SecondCodeHandlerModule)).rejects.toThrow(DuplicateStepKindHandlerError);
    await expect(boot(SecondGuardModule)).rejects.toThrow(DuplicateStartGuardError);
  });

  it('lists the unfinished PhaseRuns and their StepRuns in GET /api/state, not the finished ones', async () => {
    const finished = await admit('41');
    await inAlice((tx) => engine.stop(tx, finished.id));
    const run = await admit('42');
    await signal(run.id, 'st-code', done([CHANGE]));

    const { phaseRuns, stepRuns: listed } = await state();

    expect(phaseRuns).toEqual([run]);
    expect(listed.map((candidate) => [candidate.phaseRunId, candidate.stepId, candidate.state])).toEqual([
      [run.id, 'st-code', 'done'],
      [run.id, 'st-checks', 'running'],
      [run.id, 'st-rv', 'waiting'],
    ]);
    expect(listed[0]?.outputs).toEqual([CHANGE]);
  });
});
