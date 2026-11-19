import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CATALOGUE,
  PROCESS_CREWDECK,
  type ProcessDefinition,
  type ProcessDraftInput,
  type ProjectProcess,
  type StepKind,
  zProjectList,
  zProjectProcess,
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
import { STEP_KIND_HANDLERS, type StepKindHandlers, type StepResult } from '../../src/process/engine/kinds/handler.js';
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

const FIXTURES = join(import.meta.dirname, '../../../../packages/contracts/fixtures/process');
const fixture = (name: string): ProcessDefinition =>
  (JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as { definition: ProcessDefinition }).definition;

/** « Process Crewdeck » with the Retour of « Review » allowed `max` times. */
const reviewMax = (max: number): ProcessDefinition => {
  const definition = structuredClone(PROCESS_CREWDECK);
  const loopBack = definition.loopBacks.find((candidate) => candidate.from === 'st-review');
  if (loopBack) loopBack.max = max;
  return definition;
};

/** The Étape « Code » starts and runs until the test stops it: a Ticket's work in progress. */
@Module({ imports: [EngineModule] })
class RunningCodeModule implements OnModuleInit {
  constructor(@Inject(STEP_KIND_HANDLERS) private readonly handlers: StepKindHandlers) {}

  onModuleInit(): void {
    const kind: StepKind = 'code';
    this.handlers.add({
      kind,
      start: () => Promise.resolve(CATALOGUE[kind].family === 'gate' ? 'waiting' : 'running'),
      onSignal: (_tx, _run, signal) => Promise.resolve(signal as StepResult | null),
      stop: () => Promise.resolve(),
    });
  }
}

interface Tab {
  id: string;
  cookie: string;
}

interface EventRow {
  type: string;
  payload: Record<string, unknown>;
  tx: string;
}

describe('POST /api/projects/:id/process/activate against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let fakes: Fakes;
  let engine: Engine;

  beforeAll(async () => {
    ({ app, url } = await startApp(env, { imports: [RunningCodeModule] }));
    prisma = app.get(PrismaService);
    fakes = app.get<Fakes>(FAKES);
    engine = app.get(Engine);
  });

  const empty = () => sql('TRUNCATE pilots, github_installations, github_deliveries CASCADE');

  afterAll(async () => {
    await empty();
    await app.close();
  });

  const pilot = async (githubUserId: number, login: string): Promise<Tab> => {
    const id = newId();
    await sql(
      `WITH p AS (INSERT INTO pilots (id, display_name, time_zone, getting_started_step) VALUES ($1, $3, 'Europe/Paris', 'projects') RETURNING id) INSERT INTO pilot_identities (id, pilot_id, provider, subject, login) SELECT gen_random_uuid(), id, 'github', $2::text, $3 FROM p`,
      [id, githubUserId, login],
    );
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  const call = (tab: Tab | undefined, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method,
      headers: { ...(tab ? { cookie: tab.cookie } : {}), origin: ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const state = async (tab: Tab) => zState.parse(await (await call(tab, 'GET', '/api/state')).json());
  const eventsOf = (tab: Tab): Promise<EventRow[]> => sql<EventRow>('SELECT type, payload, xmin::text AS tx FROM events WHERE pilot_id = $1 ORDER BY seq', [tab.id]);

  let alice: Tab;
  let projectId: string;

  beforeEach(async () => {
    await empty();
    fakes.github.reset();
    fakes.github.seedRepo({ ...APP_REPO, installationId: INSTALLATION_ID, files: { 'README.md': '# App' } });
    alice = await pilot(SENDER_ID, 'octo-fixture');
    expect((await deliverWebhook(url, { event: 'installation', payload: created })).status).toBe(202);
    await app.get(WebhookDispatcher).settled();
    const { seq, repositories } = await state(alice);
    const followed = await call(alice, 'POST', '/api/projects', { repositoryIds: repositories.map((repository) => repository.id), templateId: 'process-crewdeck', seq: String(seq) });
    expect(followed.status).toBe(201);
    projectId = zProjectList.parse(await followed.json()).items[0]?.id ?? '';
  });

  const saved = async (res: Response): Promise<ProjectProcess> => {
    expect(res.status).toBe(200);
    return zProjectProcess.parse(await res.json());
  };
  const getProcess = (tab: Tab = alice, id = projectId) => call(tab, 'GET', `/api/projects/${id}/process`);
  /** A draft of `definition`, on what the Projet's Process is now. */
  const draft = async (definition: ProcessDefinition): Promise<ProjectProcess> => {
    const now = await saved(await getProcess());
    const input: ProcessDraftInput = { definition, sealed: null, revision: now.draft?.revision ?? 0, baseVersion: now.active?.number ?? 0 };
    return saved(await call(alice, 'PUT', `/api/projects/${projectId}/process/draft`, input));
  };
  /** The activation as the dialog confirms it: the draft's revision, the `seq` the page holds. */
  const activate = async (tab: Tab = alice, id = projectId, body?: Record<string, unknown>): Promise<Response> => {
    if (body) return call(tab, 'POST', `/api/projects/${id}/process/activate`, body);
    const { seq } = await state(tab);
    const view = await saved(await getProcess(tab, id));
    return call(tab, 'POST', `/api/projects/${id}/process/activate`, { revision: view.draft?.revision ?? 1, seq: String(seq) });
  };
  /** Drafts `definition` then activates it: the next version. */
  const next = async (definition: ProcessDefinition): Promise<ProjectProcess> => {
    await draft(definition);
    return saved(await activate());
  };

  const inAlice = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => runInPilotScope(alice.id, () => app.get(Transactions).run(fn));
  const admit = (ticket: string) => inAlice((tx) => engine.admit(tx, { projectId, phaseId: 'ph-dev', item: { type: 'ticket', id: ticket } }));

  it('writes version n+1 with the draft, deletes the draft and writes process.upserted, in one transaction', async () => {
    await draft(reviewMax(5));

    const view = await saved(await activate());

    expect(view.active).toEqual({ number: 2, definition: reviewMax(5), sealed: null, activatedAt: expect.any(String), activatedBy: 'pilot', templateName: null });
    expect(view.draft).toBeNull();
    expect(await sql('SELECT id FROM process_drafts WHERE project_id = $1', [projectId])).toEqual([]);
    const [version] = await sql<{ tx: string }>('SELECT xmin::text AS tx FROM process_versions WHERE project_id = $1 AND number = 2', [projectId]);
    const event = (await eventsOf(alice)).at(-1);
    expect(event?.type).toBe('process.upserted');
    expect(zProjectProcess.parse(event?.payload)).toEqual(view);
    expect(event?.tx).toBe(version?.tx);
    expect((await state(alice)).processes).toEqual([view]);
    // Version 1 stays as it was: versions are immutable.
    expect(await sql('SELECT number, activated_by FROM process_versions WHERE project_id = $1 ORDER BY number', [projectId])).toEqual([
      { number: 1, activated_by: 'creation' },
      { number: 2, activated_by: 'pilot' },
    ]);
  });

  it('activates a Projet’s first draft as version 1', async () => {
    await sql('DELETE FROM process_versions WHERE project_id = $1', [projectId]);
    await draft(PROCESS_CREWDECK);

    const view = await saved(await activate());

    expect(view.active?.number).toBe(1);
    expect(view.active?.activatedBy).toBe('pilot');
    expect(view.draft).toBeNull();
  });

  it('answers 409 process.no-draft without a draft, and writes nothing', async () => {
    const before = await eventsOf(alice);
    const { seq } = await state(alice);
    await expectEnvelope(await activate(alice, projectId, { revision: 1, seq: String(seq) }), 409, 'process.no-draft');
    expect(await eventsOf(alice)).toEqual(before);
  });

  it('answers 409 process.draft-stale for another revision than the draft’s', async () => {
    const view = await draft(reviewMax(5));
    const { seq } = await state(alice);
    await expectEnvelope(await activate(alice, projectId, { revision: (view.draft?.revision ?? 0) + 1, seq: String(seq) }), 409, 'process.draft-stale');
    expect(await sql('SELECT number FROM process_versions WHERE project_id = $1', [projectId])).toEqual([{ number: 1 }]);
  });

  it('answers 409 sensitive-action.stale when the draft changed after the seq the Pilote confirmed on', async () => {
    const { seq } = await state(alice);
    const view = await draft(reviewMax(5));
    await expectEnvelope(await activate(alice, projectId, { revision: view.draft?.revision, seq: String(seq) }), 409, 'sensitive-action.stale');
    expect((await saved(await getProcess())).draft).not.toBeNull();
  });

  it('answers 422 process.has-gaps for a draft with a Manque, with its fields, and keeps the draft', async () => {
    await draft(fixture('input-unfed'));

    const res = await activate();

    const { fields } = await expectEnvelope(res, 422, 'process.has-gaps');
    expect(Object.keys(fields ?? {})).toEqual(['steps.st-merge.inputs.v-rv']);
    expect(await sql('SELECT number FROM process_versions WHERE project_id = $1', [projectId])).toEqual([{ number: 1 }]);
    expect((await saved(await getProcess())).draft?.definition).toEqual(fixture('input-unfed'));
  });

  it('answers 422 process.invalid for a draft validateDefinition refuses', async () => {
    await draft(reviewMax(5));
    // Only a write outside the API can leave a draft refused: the route checks anyway.
    await sql('UPDATE process_drafts SET definition = $2 WHERE project_id = $1', [projectId, JSON.stringify(fixture('arrow-cycle'))]);

    await expectEnvelope(await activate(), 422, 'process.invalid');
  });

  it('answers 422 process.no-change for a draft that is the active version', async () => {
    await draft(PROCESS_CREWDECK);

    const res = await activate();

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'process.no-change', message: 'Le brouillon ne change rien à la v1.' });
  });

  it('answers 404 for an unknown Projet, another Pilote’s, or an id that is not one; 400 without a revision or a seq', async () => {
    await draft(reviewMax(5));
    const bob = await pilot(9100002, 'bob-fixture');
    const { seq } = await state(bob);

    await expectEnvelope(await activate(bob, projectId, { revision: 1, seq: String(seq) }), 404, 'project.not-found');
    await expectEnvelope(await activate(alice, newId(), { revision: 1, seq: String(seq) }), 404, 'project.not-found');
    await expectEnvelope(await activate(alice, 'pas-un-id', { revision: 1, seq: String(seq) }), 404, 'project.not-found');
    expect((await activate(alice, projectId, { seq: String(seq) })).status).toBe(400);
    expect((await activate(alice, projectId, { revision: 1 })).status).toBe(400);
  });

  it('keeps a PhaseRun running on v3 on v3, and pins to v4 what is admitted after', async () => {
    await next(reviewMax(4));
    await next(reviewMax(5));
    const before = await admit(newId());
    expect(before.processVersion).toBe(3);

    const v4 = await next(reviewMax(6));
    const after = await admit(newId());

    expect(v4.active?.number).toBe(4);
    expect(after.processVersion).toBe(4);
    expect(await sql('SELECT pr.id, v.number FROM phase_runs pr JOIN process_versions v ON v.id = pr.process_version_id ORDER BY v.number')).toEqual([
      { id: before.id, number: 3 },
      { id: after.id, number: 4 },
    ]);
    expect((await saved(await getProcess())).running.map((work) => [work.phaseRunId, work.versionNumber])).toEqual([
      [before.id, 3],
      [after.id, 4],
    ]);
  });

  it('lists a Ticket’s work by its number, and writes process.upserted when a PhaseRun starts and when it ends', async () => {
    const ticketId = newId();
    await sql(
      `INSERT INTO tickets (id, pilot_id, project_id, source, number, title, state, ready_mark, ready, branch_prefix, visual_review, source_created_at, source_updated_at, updated_at)
       VALUES ($1, $2, $3, 'github', 53, 'Agenda', 'open', false, false, 'feat', false, now(), now(), now())`,
      [ticketId, alice.id, projectId],
    );
    const run = await admit(ticketId);

    const started = (await eventsOf(alice)).filter((event) => event.type === 'process.upserted').at(-1);
    expect(zProjectProcess.parse(started?.payload).running).toEqual([{ phaseRunId: run.id, versionNumber: 1, phaseId: 'ph-dev', itemType: 'ticket', itemId: ticketId, ticketNumber: 53 }]);

    await inAlice((tx) => engine.stop(tx, run.id));

    const ended = (await eventsOf(alice)).filter((event) => event.type === 'process.upserted').at(-1);
    expect(zProjectProcess.parse(ended?.payload).running).toEqual([]);
  });

  it('activates once for two activations at once: one version, the other 409 process.no-draft', async () => {
    await draft(reviewMax(5));
    const { seq } = await state(alice);
    const view = await saved(await getProcess());
    const body = { revision: view.draft?.revision, seq: String(seq) };

    const answers = await Promise.all([activate(alice, projectId, body), activate(alice, projectId, body)]);

    expect(answers.map((res) => res.status).sort()).toEqual([200, 409]);
    const refused = answers.find((res) => res.status === 409);
    expect(((await refused?.json()) as { code: string }).code).toBe('process.no-draft');
    expect(await sql('SELECT number FROM process_versions WHERE project_id = $1 ORDER BY number', [projectId])).toEqual([{ number: 1 }, { number: 2 }]);
  });
});
