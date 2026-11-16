import {
  type ArtifactRef,
  CATALOGUE,
  eventPayloadSchema,
  type EventType,
  PROCESS_CREWDECK,
  type ProcessDefinition,
  type StepKind,
  zPhaseRun,
  zProjectList,
  zState,
} from '@crewdeck/contracts';
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
import { PHASE_ITEMS, type PhaseItemHandlers } from '../../src/process/engine/items.js';
import { STEP_KIND_HANDLERS, type StepKindHandler, type StepKindHandlers, type StepResult } from '../../src/process/engine/kinds/handler.js';
import { Transactions, type Tx } from '../../src/realtime/transactions.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import { deliverWebhook, TEST_WEBHOOK_SECRET, webhookFixture } from '../fakes/github.js';
import { authKeysEnv } from '../github-app.js';
import { expectEnvelope, startApp } from '../route-baseline.js';

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

/** What the test handlers did: each `stop`, by Étape; their `onSignal` gives back the signal as the result. */
const stops: string[] = [];
/** The items the test item handler stopped, by id. */
const stoppedItems: string[] = [];
const HANDLED: readonly StepKind[] = ['code', 'checks', 'review', 'visual-review', 'merge', 'approval', 'cross-review', 'prd'];
const handler = (kind: StepKind): StepKindHandler => ({
  kind,
  start: () => Promise.resolve(CATALOGUE[kind].family === 'gate' ? 'waiting' : 'running'),
  onSignal: (_tx, _run, signal) => Promise.resolve(signal as StepResult | null),
  stop: (_tx, run) => {
    stops.push(run.step.id);
    return Promise.resolve();
  },
});

@Module({ imports: [EngineModule] })
class TestHandlersModule implements OnModuleInit {
  constructor(
    @Inject(STEP_KIND_HANDLERS) private readonly handlers: StepKindHandlers,
    @Inject(PHASE_ITEMS) private readonly items: PhaseItemHandlers,
  ) {}

  onModuleInit(): void {
    for (const kind of HANDLED) this.handlers.add(handler(kind));
    // A Ticket, as BOUCLE-2's will be: its number and title, closed on « Arrêter ».
    this.items.add({
      itemType: 'ticket',
      label: (_tx, itemId) => Promise.resolve(`#${itemId} Recherche d’actes`),
      onStopped: (_tx, phaseRun) => {
        stoppedItems.push(phaseRun.itemId);
        return Promise.resolve();
      },
    });
  }
}

interface StepRunRow {
  id: string;
  step_id: string;
  state: string;
  iteration: number;
  reason: string | null;
}

interface EventRow {
  type: string;
  payload: Record<string, unknown>;
  tx: string;
}

const CHANGE: ArtifactRef = { portId: 'changement', type: 'code-change', id: '57', sha: 'a'.repeat(40) };
const verdict = (id: string): ArtifactRef => ({ portId: 'verdict', type: 'verdict', id });
const done = (outputs: ArtifactRef[], verdictOf?: 'passed' | 'changes'): StepResult => ({ state: 'done', outputs, ...(verdictOf ? { verdict: verdictOf } : {}) });
const CHANGES = done([verdict('v-review')], 'changes');

describe('the Retours against PostgreSQL', () => {
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

  const pilot = async (githubUserId: number, login: string): Promise<{ id: string; cookie: string }> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone, getting_started_step) VALUES ($1, $2, $3, 'Europe/Paris', 'projects')`, [id, githubUserId, login]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  const call = (method: 'GET' | 'POST', path: string, body?: unknown, cookie: string | null = alice.cookie): Promise<Response> =>
    fetch(`${url}${path}`, {
      method,
      headers: { ...(cookie === null ? {} : { cookie }), origin: ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const state = async () => zState.parse(await (await call('GET', '/api/state')).json());

  beforeEach(async () => {
    await empty();
    stops.length = 0;
    stoppedItems.length = 0;
    fakes.github.reset();
    fakes.github.seedRepo({ ...APP_REPO, installationId: INSTALLATION_ID, files: { 'README.md': '# App' } });
    alice = await pilot(SENDER_ID, 'octo-fixture');
    expect((await deliverWebhook(url, { event: 'installation', payload: created })).status).toBe(202);
    await app.get(WebhookDispatcher).settled();
    const { seq, repositories } = await state();
    const followed = await call('POST', '/api/projects', { repositoryIds: repositories.map((repository) => repository.id), seq: String(seq) });
    expect(followed.status).toBe(201);
    projectId = zProjectList.parse(await followed.json()).items[0]?.id ?? '';
  });

  const inAlice = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => runInPilotScope(alice.id, () => app.get(Transactions).run(fn));
  const admit = (ticket = '57') => inAlice((tx) => engine.admit(tx, { projectId, phaseId: 'ph-dev', item: { type: 'ticket', id: ticket } }));
  const stepRuns = (phaseRunId: string) => sql<StepRunRow>('SELECT id, step_id, state, iteration, reason FROM step_runs WHERE phase_run_id = $1 ORDER BY id', [phaseRunId]);
  const stepRun = async (phaseRunId: string, stepId: string): Promise<StepRunRow> => {
    const found = (await stepRuns(phaseRunId)).filter((run) => run.step_id === stepId).at(-1);
    if (!found) throw new Error(`No StepRun of ${stepId}`);
    return found;
  };
  const signal = async (phaseRunId: string, stepId: string, result: StepResult) => inAlice(async (tx) => engine.signal(tx, (await stepRun(phaseRunId, stepId)).id, result));
  const phaseRun = async (phaseRunId: string) => {
    const [row] = await sql<{ state: string; waiting_on: string | null; loop_backs: unknown }>('SELECT state, waiting_on, loop_backs FROM phase_runs WHERE id = $1', [phaseRunId]);
    return row;
  };
  const openDecisions = () => sql<{ id: string; kind: string; subject_id: string; label: string; params: Record<string, unknown> }>(
    "SELECT id, kind, subject_id, label, params FROM decisions WHERE state = 'open' ORDER BY created_at",
  );
  const eventsSince = (seq: number) => sql<EventRow>('SELECT type, payload, xmin::text AS tx FROM events WHERE pilot_id = $1 AND seq > $2 ORDER BY seq', [alice.id, seq]);
  const lastSeq = async () => Number((await sql<{ seq: string }>('SELECT seq::text FROM pilots WHERE id = $1', [alice.id]))[0]?.seq);
  const expectOneTransaction = (events: EventRow[]) => {
    expect(new Set(events.map((event) => event.tx)).size).toBe(1);
    for (const event of events) expect(eventPayloadSchema(event.type as EventType)?.safeParse(event.payload).success, event.type).toBe(true);
  };

  /** A version written beside the active one, the next number. */
  const writeVersion = async (definition: ProcessDefinition): Promise<void> => {
    await sql(
      `INSERT INTO process_versions (id, pilot_id, project_id, number, definition, activated_at, activated_by)
       SELECT $1, $2, $3, max(number) + 1, $4, now(), 'pilot' FROM process_versions WHERE project_id = $3`,
      [newId(), alice.id, projectId, JSON.stringify(definition)],
    );
  };
  const withoutLoopBackFrom = (stepId: string): ProcessDefinition => ({ ...PROCESS_CREWDECK, loopBacks: PROCESS_CREWDECK.loopBacks.filter((loopBack) => loopBack.from !== stepId) });

  /** The Code then the Checks of the current pass, up to the Review running. */
  const upToReview = async (runId: string) => {
    await signal(runId, 'st-code', done([CHANGE]));
    await signal(runId, 'st-checks', done([verdict('v-checks')], 'passed'));
  };

  /** The PhaseRun of Ticket #57 whose Review asked changes three times, the fourth raising « Maximum de Retours atteint ». */
  const exhausted = async () => {
    const run = await admit();
    for (let pass = 0; pass < 4; pass += 1) {
      await upToReview(run.id);
      await signal(run.id, 'st-review', CHANGES);
    }
    const [decision] = await openDecisions();
    if (!decision) throw new Error('No Décision');
    return { run, decision };
  };

  it('sends the work back to st-code three times on the Review’s « changements », every StepRun from it superseded; the fourth raises « Maximum de Retours atteint » and the PhaseRun waits', async () => {
    const run = await admit();

    for (let pass = 1; pass <= 3; pass += 1) {
      await upToReview(run.id);
      await signal(run.id, 'st-review', CHANGES);
      const runs = await stepRuns(run.id);
      expect(runs.filter((candidate) => candidate.iteration === pass).map((candidate) => `${candidate.step_id}:${candidate.state}`)).toEqual([
        'st-code:superseded',
        'st-checks:superseded',
        'st-rv:superseded',
        'st-review:superseded',
      ]);
      expect(runs.filter((candidate) => candidate.iteration === pass + 1).map((candidate) => [candidate.step_id, candidate.state, candidate.reason])).toEqual([['st-code', 'running', 'loop-back']]);
      expect(await phaseRun(run.id)).toMatchObject({ state: 'running', waiting_on: null, loop_backs: [{ from: 'st-review', to: 'st-code', taken: pass, extra: 0 }] });
    }
    expect(await openDecisions()).toEqual([]);
    expect(stops.filter((stepId) => stepId === 'st-rv')).toHaveLength(3);

    await upToReview(run.id);
    const before = await lastSeq();
    await signal(run.id, 'st-review', CHANGES);

    expect(await phaseRun(run.id)).toMatchObject({ state: 'waiting', waiting_on: 'decision', loop_backs: [{ from: 'st-review', to: 'st-code', taken: 3, extra: 0 }] });
    expect(await stepRun(run.id, 'st-review')).toMatchObject({ state: 'done', iteration: 4 });
    expect(await stepRun(run.id, 'st-rv')).toMatchObject({ state: 'waiting', iteration: 4 });
    const [decision] = await openDecisions();
    const review = await stepRun(run.id, 'st-review');
    expect(decision).toMatchObject({
      kind: 'loop-back.exhausted',
      subject_id: run.id,
      label: '#57 Recherche d’actes',
      params: { phaseRunId: run.id, stepRunId: review.id, stepName: 'Review', targetName: 'Code', taken: 3, max: 3, canContinue: true, sessionId: null },
    });
    const events = await eventsSince(before);
    expect(events.map((event) => event.type)).toEqual(['step-run.upserted', 'phase-run.upserted', 'decision.upserted']);
    expectOneTransaction(events);
    expect(events[2]?.payload).toMatchObject({ subjectType: 'phase-run', tone: 'caution', metaParts: ['Review'], link: '/a-toi', projectId, projectName: expect.any(String) });
    expect(zPhaseRun.parse(events[1]?.payload).loopBacks).toEqual([{ from: 'st-review', to: 'st-code', taken: 3, extra: 0 }]);
  });

  it('counts each Retour on its own: the Revue visuelle’s « changements » takes its Retour while the Review’s is at three', async () => {
    const run = await admit();
    for (let pass = 0; pass < 3; pass += 1) {
      await upToReview(run.id);
      await signal(run.id, 'st-review', CHANGES);
    }
    await upToReview(run.id);
    await signal(run.id, 'st-rv', done([verdict('v-rv')], 'changes'));

    expect(await phaseRun(run.id)).toMatchObject({
      state: 'running',
      loop_backs: [
        { from: 'st-review', to: 'st-code', taken: 3, extra: 0 },
        { from: 'st-rv', to: 'st-code', taken: 1, extra: 0 },
      ],
    });
    expect(await stepRun(run.id, 'st-code')).toMatchObject({ state: 'running', iteration: 5, reason: 'loop-back' });
    expect(await openDecisions()).toEqual([]);
  });

  it('links the Décision to the Session of the Étape that asked the changements', async () => {
    const run = await admit();
    for (let pass = 0; pass < 3; pass += 1) {
      await upToReview(run.id);
      await signal(run.id, 'st-review', CHANGES);
    }
    await upToReview(run.id);
    const sessionId = newId();
    await sql('UPDATE step_runs SET session_id = $1 WHERE id = $2', [sessionId, (await stepRun(run.id, 'st-review')).id]);
    await signal(run.id, 'st-review', CHANGES);

    const [decision] = await sql<{ link: string; params: Record<string, unknown> }>("SELECT link, params FROM decisions WHERE state = 'open'");
    expect(decision).toMatchObject({ link: `/a-toi?session=${sessionId}`, params: { sessionId } });
  });

  it('only records a « changements » while the PhaseRun waits on « Maximum de Retours atteint »: the Pilote’s answer says what follows', async () => {
    const { run } = await exhausted();
    const before = await lastSeq();
    await signal(run.id, 'st-rv', done([verdict('v-rv')], 'changes'));

    expect(await stepRun(run.id, 'st-rv')).toMatchObject({ state: 'done', iteration: 4 });
    expect(await phaseRun(run.id)).toMatchObject({ state: 'waiting', waiting_on: 'decision', loop_backs: [{ from: 'st-review', to: 'st-code', taken: 3, extra: 0 }] });
    expect((await eventsSince(before)).map((event) => event.type)).toEqual(['step-run.upserted']);
    expect(await openDecisions()).toHaveLength(1);
  });

  it('« Encore un passage » sends the work back once more, resolves the Décision, and the next « changements » raises it again', async () => {
    const { run, decision } = await exhausted();
    const before = await lastSeq();

    const response = await call('POST', `/api/phase-runs/${run.id}/one-more-pass`, { decisionId: decision.id });

    expect(response.status).toBe(200);
    expect(zPhaseRun.parse(await response.json())).toMatchObject({ id: run.id, state: 'running', waitingOn: null, loopBacks: [{ from: 'st-review', to: 'st-code', taken: 4, extra: 1 }] });
    expect(await stepRun(run.id, 'st-code')).toMatchObject({ state: 'running', iteration: 5, reason: 'loop-back' });
    expect((await stepRuns(run.id)).filter((candidate) => candidate.iteration === 4).map((candidate) => candidate.state)).toEqual(['superseded', 'superseded', 'superseded', 'superseded']);
    expect(await sql("SELECT state, outcome FROM decisions WHERE id = $1", [decision.id])).toEqual([{ state: 'resolved', outcome: 'one-more-pass' }]);
    const events = await eventsSince(before);
    expect(events.map((event) => event.type)).toContain('decision.removed');
    expectOneTransaction(events);

    await upToReview(run.id);
    await signal(run.id, 'st-review', CHANGES);
    const [again] = await openDecisions();
    expect(again).toMatchObject({ kind: 'loop-back.exhausted', subject_id: run.id, params: { taken: 4, max: 3, canContinue: true } });
    expect(again?.id).not.toBe(decision.id);
    expect(await phaseRun(run.id)).toMatchObject({ state: 'waiting', waiting_on: 'decision' });
  });

  it('« Arrêter » stops the PhaseRun, its running StepRuns and the item, and resolves the Décision', async () => {
    const { run, decision } = await exhausted();
    stops.length = 0;
    const before = await lastSeq();

    const response = await call('POST', `/api/phase-runs/${run.id}/stop`, { decisionId: decision.id });

    expect(response.status).toBe(200);
    expect(zPhaseRun.parse(await response.json())).toMatchObject({ id: run.id, state: 'stopped' });
    expect(await stepRun(run.id, 'st-rv')).toMatchObject({ state: 'stopped' });
    expect(stops).toEqual(['st-rv']);
    expect(stoppedItems).toEqual(['57']);
    expect(await sql("SELECT state, outcome FROM decisions WHERE id = $1", [decision.id])).toEqual([{ state: 'resolved', outcome: 'stopped' }]);
    const events = await eventsSince(before);
    expect(events.map((event) => event.type)).toEqual(['step-run.upserted', 'phase-run.upserted', 'decision.removed']);
    expectOneTransaction(events);
    expect((await state()).phaseRuns).toEqual([]);
  });

  it('answers once: 409 decision.already-answered after « Arrêter » or « Encore un passage »', async () => {
    const { run, decision } = await exhausted();
    expect((await call('POST', `/api/phase-runs/${run.id}/stop`, { decisionId: decision.id })).status).toBe(200);

    for (const answer of ['stop', 'one-more-pass']) {
      const response = await call('POST', `/api/phase-runs/${run.id}/${answer}`, { decisionId: decision.id });
      await expectEnvelope(response, 409, 'decision.already-answered');
    }
  });

  it('answers only the Pilote’s own PhaseRun and its own Décision: 404 otherwise, 400 without a Décision, 401 signed out', async () => {
    const { run, decision } = await exhausted();
    const bob = await pilot(SENDER_ID + 1, 'bob-fixture');
    const other = await admit('58');

    for (const answer of ['stop', 'one-more-pass']) {
      const path = `/api/phase-runs/${run.id}/${answer}`;
      const asBob = await call('POST', path, { decisionId: decision.id }, bob.cookie);
      await expectEnvelope(asBob, 404, 'phase-run.not-found');
      for (const id of [newId(), 'not-an-id']) {
        const unknown = await call('POST', `/api/phase-runs/${id}/${answer}`, { decisionId: decision.id });
        await expectEnvelope(unknown, 404, 'phase-run.not-found');
      }
      const notItsOwn = await call('POST', `/api/phase-runs/${other.id}/${answer}`, { decisionId: decision.id });
      await expectEnvelope(notItsOwn, 404, 'decision.not-found');
      const unknownDecision = await call('POST', path, { decisionId: newId() });
      await expectEnvelope(unknownDecision, 404, 'decision.not-found');
      const invalid = await call('POST', path, {});
      await expectEnvelope(invalid, 400, 'validation.invalid');
      expect((await call('POST', path, { decisionId: decision.id }, null)).status).toBe(401);
    }
    expect(await phaseRun(run.id)).toMatchObject({ state: 'waiting', waiting_on: 'decision' });
    expect(await openDecisions()).toHaveLength(1);
  });

  it('stops the item without a Retour to take when none leaves the Review: only « Arrêter », « Encore un passage » refused with 422', async () => {
    await writeVersion(withoutLoopBackFrom('st-review'));
    const run = await admit();
    await upToReview(run.id);
    await signal(run.id, 'st-review', CHANGES);

    expect(await phaseRun(run.id)).toMatchObject({ state: 'waiting', waiting_on: 'decision', loop_backs: [] });
    const [decision] = await openDecisions();
    expect(decision).toMatchObject({ kind: 'loop-back.exhausted', params: { stepName: 'Review', targetName: null, taken: null, max: null, canContinue: false } });

    const refused = await call('POST', `/api/phase-runs/${run.id}/one-more-pass`, { decisionId: decision?.id });
    await expectEnvelope(refused, 422, 'phase-run.no-loop-back');
    expect(await openDecisions()).toHaveLength(1);
    expect((await call('POST', `/api/phase-runs/${run.id}/stop`, { decisionId: decision?.id })).status).toBe(200);
  });

  it('refuses a « changements » of a gate without a Retour, nothing written; its StepRun says it cannot ask for changes', async () => {
    await writeVersion(withoutLoopBackFrom('st-rv'));
    const run = await admit();
    await upToReview(run.id);
    const before = await lastSeq();

    await expect(signal(run.id, 'st-rv', done([verdict('v-rv')], 'changes'))).rejects.toMatchObject({ status: 422, code: 'step-run.no-loop-back' });

    expect(await stepRun(run.id, 'st-rv')).toMatchObject({ state: 'waiting' });
    expect(await eventsSince(before)).toEqual([]);
    const { stepRuns: visible } = await state();
    expect(visible.find((candidate) => candidate.stepId === 'st-rv')?.canAskChanges).toBe(false);
    expect(visible.find((candidate) => candidate.stepId === 'st-review')?.canAskChanges).toBe(true);
  });

  it('says which StepRuns may ask for changes in « Process Crewdeck »: the Review and the Revue visuelle, not the Code', async () => {
    const run = await admit();
    await upToReview(run.id);

    const byStep = Object.fromEntries((await state()).stepRuns.filter((candidate) => candidate.phaseRunId === run.id).map((candidate) => [candidate.stepId, candidate.canAskChanges]));
    expect(byStep).toEqual({ 'st-code': false, 'st-checks': false, 'st-review': true, 'st-rv': true });
  });
});
