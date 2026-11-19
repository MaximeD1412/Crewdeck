import { CATALOGUE, PROCESS_CREWDECK, type ProcessDefinition, type SourceMigration, type StepKind, zDecision, zProjectList, zProjectProcess, zSourceMigration, zSourceMigrationPage, zState } from '@crewdeck/contracts';
import { type INestApplication, Inject, Module, type OnModuleInit } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { WebhookDispatcher } from '../../src/github/webhooks/dispatcher.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { ReadinessService } from '../../src/projects/readiness/readiness.service.js';
import { Engine } from '../../src/process/engine/engine.js';
import { EngineModule } from '../../src/process/engine/engine.module.js';
import { STEP_KIND_HANDLERS, type StepKindHandler, type StepKindHandlers } from '../../src/process/engine/kinds/handler.js';
import { FinishSweep } from '../../src/process/sources/migrations/finish-sweep.job.js';
import { SourceMigrations } from '../../src/process/sources/migrations/source-migrations.service.js';
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
const FINGERPRINT = { key: 'ticket:12', state: 'open', contentHash: 'a'.repeat(64) };

/** Every Étape of « Process Crewdeck » runs (a gate waits on the Pilote) until the test stops its PhaseRun. */
const HANDLED: readonly StepKind[] = ['idea-analysis', 'idea-triage', 'prd', 'cross-review', 'approval', 'mockups', 'technical-design', 'split', 'code', 'checks', 'review', 'visual-review', 'merge', 'command'];
const handler = (kind: StepKind): StepKindHandler => ({
  kind,
  start: () => Promise.resolve(CATALOGUE[kind].family === 'gate' ? 'waiting' : 'running'),
  onSignal: () => Promise.resolve(null),
});

/** What the `ticket` group's switch hook does: `throw` refuses the switch, as SOURCE-8's could. */
let hookMode: 'pass' | 'throw' = 'pass';
const hookCalls: string[] = [];

@Module({ imports: [EngineModule] })
class TestHandlersModule implements OnModuleInit {
  constructor(@Inject(STEP_KIND_HANDLERS) private readonly handlers: StepKindHandlers) {}

  onModuleInit(): void {
    for (const kind of HANDLED) this.handlers.add(handler(kind));
  }
}

interface EventRow {
  seq: string;
  type: string;
  payload: Record<string, unknown>;
  tx: string;
}

describe('moving a Type d’artefact to another Source, against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let fakes: Fakes;
  let engine: Engine;
  let migrations: SourceMigrations;
  let alice: { id: string; cookie: string; token: string };
  let projectId: string;
  const sockets: FakeRunnerClient[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp(env, { imports: [TestHandlersModule] }));
    prisma = app.get(PrismaService);
    fakes = app.get<Fakes>(FAKES);
    engine = app.get(Engine);
    migrations = app.get(SourceMigrations);
    migrations.registerSwitchHook('ticket', async (tx, migration, message) => {
      hookCalls.push(`${migration.id}:${message.renumbering.length}`);
      await tx.ticket.updateMany({ where: { projectId: migration.projectId }, data: { source: 'github' } });
      if (hookMode === 'throw') throw new Error('hook refused');
    });
  });

  const empty = () => sql('TRUNCATE pilots, github_installations, github_deliveries CASCADE');

  afterAll(async () => {
    await empty();
    await app.close();
  });

  const call = (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, cookie = alice.cookie): Promise<Response> =>
    fetch(`${url}${path}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), origin: ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const state = async () => zState.parse(await (await call('GET', '/api/state')).json());
  // The readiness writes its own `project.upserted` after a change: the seq the page holds once it is written.
  const lastSeq = async (): Promise<string> => {
    await app.get(ReadinessService).settled();
    return (await sql<{ seq: string }>('SELECT seq::text FROM pilots WHERE id = $1', [alice.id]))[0]?.seq ?? '0';
  };

  beforeEach(async () => {
    await empty();
    hookMode = 'pass';
    hookCalls.length = 0;
    fakes.github.reset();
    fakes.github.seedRepo({ ...APP_REPO, installationId: INSTALLATION_ID, files: { 'README.md': '# App' } });
    const id = newId();
    await sql(
      `WITH p AS (INSERT INTO pilots (id, display_name, time_zone, getting_started_step) VALUES ($1, 'octo-fixture', 'Europe/Paris', 'done') RETURNING id) INSERT INTO pilot_identities (id, pilot_id, provider, subject, login) SELECT gen_random_uuid(), id, 'github', $2::text, 'octo-fixture' FROM p`,
      [id, SENDER_ID],
    );
    const cookie = `${SESSION_COOKIE}=${await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined))}`;
    const { token } = await createLinkedRunner(prisma, id);
    alice = { id, cookie, token };
    expect((await deliverWebhook(url, { event: 'installation', payload: created })).status).toBe(202);
    await app.get(WebhookDispatcher).settled();
    const { seq, repositories } = await state();
    const followed = await call('POST', '/api/projects', { repositoryIds: repositories.map((repository) => repository.id), templateId: 'process-crewdeck', seq: String(seq) });
    expect(followed.status).toBe(201);
    projectId = zProjectList.parse(await followed.json()).items[0]?.id ?? '';
    // The scenario of the mockups: a GitHub Projet whose Tickets are Local.
    await sql(`UPDATE artifact_sources SET source = 'local' WHERE project_id = $1 AND "group" = 'ticket'`, [projectId]);
  });

  afterEach(async () => {
    await migrations.idle();
    await Promise.all(sockets.splice(0).map((socket) => socket.close()));
  });

  const online = async (groups: ('ticket' | 'code')[] | undefined = ['ticket', 'code']): Promise<FakeRunnerClient> => {
    const socket = await connectRunner(url, alice.token);
    sockets.push(socket);
    socket.hello(groups === undefined ? {} : { migrations: groups });
    await socket.expect('hello.accepted');
    return socket;
  };

  const tickets = async (...numbers: number[]): Promise<void> => {
    for (const number of numbers) {
      await sql(
        `INSERT INTO tickets (id, pilot_id, project_id, source, number, title, state, ready_mark, ready, branch_prefix, visual_review, source_created_at, source_updated_at, updated_at)
         VALUES ($1, $2, $3, 'github', $4, 'Ticket', 'open', false, false, 'feat', false, now(), now(), now())`,
        [newId(), alice.id, projectId, number],
      );
    }
  };

  const inAlice = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => runInPilotScope(alice.id, () => app.get(Transactions).run(fn));
  const admit = (ticket: string) => inAlice((tx) => engine.admit(tx, { projectId, phaseId: 'ph-dev', item: { type: 'ticket', id: ticket } }));
  const admitIdea = (idea: string) => inAlice((tx) => engine.admit(tx, { projectId, phaseId: 'ph-idee', item: { type: 'idea', id: idea } }));
  const stop = (phaseRunId: string) => inAlice((tx) => engine.stop(tx, phaseRunId));
  const phaseRun = async (id: string) => (await sql<{ state: string; waiting_on: string | null }>('SELECT state, waiting_on FROM phase_runs WHERE id = $1', [id]))[0];
  const stepRunCount = async (phaseRunId: string) => Number((await sql<{ n: string }>('SELECT count(*)::text AS n FROM step_runs WHERE phase_run_id = $1', [phaseRunId]))[0]?.n);
  const ticketSource = async () => (await sql<{ source: string }>(`SELECT source FROM artifact_sources WHERE project_id = $1 AND "group" = 'ticket'`, [projectId]))[0]?.source;
  const row = async (id: string) =>
    (await sql<{ state: string; attempt: number; error_code: string | null; finish_tries: number; fingerprints: unknown }>(
      'SELECT state, attempt, error_code, finish_tries, fingerprints FROM source_migrations WHERE id = $1',
      [id],
    ))[0];
  const eventsSince = (seq: string) => sql<EventRow>('SELECT seq::text, type, payload, xmin::text AS tx FROM events WHERE pilot_id = $1 AND seq > $2 ORDER BY seq', [alice.id, seq]);
  const openDecisions = async () => (await sql<{ kind: string; label: string; meta_parts: string[]; tone: string; params: Record<string, unknown>; link: string }>(`SELECT kind, label, meta_parts, tone, params, link FROM decisions WHERE pilot_id = $1 AND state = 'open'`, [alice.id]));

  /** A version written beside the active one, as an activation does: the next number, its id. */
  const writeVersion = async (definition: ProcessDefinition): Promise<string> => {
    const id = newId();
    await sql(
      `INSERT INTO process_versions (id, pilot_id, project_id, number, definition, activated_at, activated_by)
       SELECT $1, $2, $3, max(number) + 1, $4, now(), 'pilot' FROM process_versions WHERE project_id = $3`,
      [id, alice.id, projectId, JSON.stringify(definition)],
    );
    return id;
  };
  /** A PhaseRun pinned to `versionId`, as the engine leaves one: its id. */
  const insertRun = async (versionId: string, phaseId: string, itemType: string, itemId: string, runState: 'running' | 'waiting', waitingOn: string | null): Promise<string> => {
    const id = newId();
    await sql(
      `INSERT INTO phase_runs (id, pilot_id, project_id, process_version_id, phase_id, item_type, item_id, state, waiting_on, started_at, loop_backs)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), '[]')`,
      [id, alice.id, projectId, versionId, phaseId, itemType, itemId, runState, waitingOn],
    );
    return id;
  };

  const migrate = async (group: 'ticket' | 'code', to: 'local' | 'github', seq?: string): Promise<Response> =>
    call('POST', `/api/projects/${projectId}/sources/${group}/migrate`, { to, seq: seq ?? (await lastSeq()) });
  const migrated = async (group: 'ticket' | 'code', to: 'local' | 'github'): Promise<SourceMigration> => {
    const res = await migrate(group, to);
    expect(res.status).toBe(201);
    return zSourceMigration.parse(await res.json());
  };

  /** A migration of the Tickets to GitHub, copying on an online Runner: its message received. */
  const copying = async (): Promise<{ migration: SourceMigration; socket: FakeRunnerClient }> => {
    await tickets(12, 14);
    const socket = await online();
    const migration = await migrated('ticket', 'github');
    await expect(socket.expect('migration.copy')).resolves.toMatchObject({ migrationId: migration.id, projectId, group: 'ticket', from: 'local', to: 'github', repository: { owner: APP_REPO.owner, name: APP_REPO.name } });
    await vi.waitFor(async () => expect((await row(migration.id))?.state).toBe('copying'));
    return { migration, socket };
  };

  describe('POST /api/projects/:id/sources/:group/migrate', () => {
    it('answers 201 with the migration draining, its event written in the transaction that created it', async () => {
      await tickets(12);
      const run = await admit('12');
      const before = await lastSeq();
      const migration = await migrated('ticket', 'github');
      expect(migration).toMatchObject({ projectId, group: 'ticket', from: 'local', to: 'github', state: 'draining', attempt: 1, waitingItems: [{ itemType: 'ticket', number: 12 }], errorCode: null });
      const [first] = (await eventsSince(before)).filter((event) => event.type === 'source-migration.upserted');
      expect(first?.payload).toMatchObject({ id: migration.id, state: 'draining' });
      const [created] = await sql<{ tx: string; last_seq: string }>('SELECT xmin::text AS tx, last_seq::text FROM source_migrations WHERE id = $1', [migration.id]);
      expect(created?.tx).toBe(first?.tx);
      expect(created?.last_seq).toBe(first?.seq);
      expect((await phaseRun(run.id))?.state).toBe('running');
    });

    it('answers 401 without a session, 400 with the fields, 404 for another Pilote’s Projet or a group that is not one', async () => {
      await expectEnvelope(await call('POST', `/api/projects/${projectId}/sources/ticket/migrate`, { to: 'github', seq: '1' }, ''), 401, 'auth.required');
      await expectFields(await call('POST', `/api/projects/${projectId}/sources/ticket/migrate`, { to: 'gitlab' }), ['to', 'seq']);
      await expectEnvelope(await call('POST', `/api/projects/${newId()}/sources/ticket/migrate`, { to: 'github', seq: await lastSeq() }), 404, 'project.not-found');
      await expectEnvelope(await call('POST', `/api/projects/${projectId}/sources/idea/migrate`, { to: 'github', seq: await lastSeq() }), 404, 'project.not-found');
    });

    it('answers 409 sensitive-action.stale with a seq older than the Projet’s last change', async () => {
      const seq = await lastSeq();
      await sql('UPDATE projects SET last_seq = $2 WHERE id = $1', [projectId, Number(seq) + 1]);
      await expectEnvelope(await migrate('ticket', 'github', seq), 409, 'sensitive-action.stale');
      expect(await sql('SELECT id FROM source_migrations')).toEqual([]);
    });

    it('answers 422 source.same, source.migration-running, source.target-missing (a Local Projet to GitHub too) and source.runner-cannot-migrate', async () => {
      await expectEnvelope(await migrate('ticket', 'local'), 422, 'source.same');
      // Both groups on GitHub: no folder of the Projet declared, even for a group that holds nothing.
      await sql(`UPDATE artifact_sources SET source = 'github' WHERE project_id = $1`, [projectId]);
      await expectEnvelope(await migrate('ticket', 'local'), 422, 'source.target-missing');
      await expectEnvelope(await migrate('code', 'local'), 422, 'source.target-missing');
      expect(await sql('SELECT id FROM source_migrations')).toEqual([]);
      await sql(`UPDATE artifact_sources SET source = 'local' WHERE project_id = $1 AND "group" = 'ticket'`, [projectId]);
      await sql('UPDATE projects SET access_lost = true WHERE id = $1', [projectId]);
      await expectEnvelope(await migrate('ticket', 'github'), 422, 'source.target-missing');
      await sql('UPDATE projects SET access_lost = false WHERE id = $1', [projectId]);
      // A Local Projet (PROJET-6) has no Dépôt GitHub to go to.
      const [project] = await sql<{ repository_id: string }>('SELECT repository_id FROM projects WHERE id = $1', [projectId]);
      await sql(`UPDATE projects SET repository_id = NULL, name_sealed = '{}', folder_state = 'present' WHERE id = $1`, [projectId]);
      await expectEnvelope(await migrate('ticket', 'github'), 422, 'source.target-missing');
      await sql('UPDATE projects SET repository_id = $2, name_sealed = NULL, folder_state = NULL WHERE id = $1', [projectId, project?.repository_id]);
      await tickets(12);
      await online(['code']);
      await expectEnvelope(await migrate('ticket', 'github'), 422, 'source.runner-cannot-migrate');
      await admit('12');
      await migrated('code', 'local');
      await expectEnvelope(await migrate('ticket', 'github'), 422, 'source.migration-running');
      expect(await sql('SELECT "group" FROM source_migrations')).toEqual([{ group: 'code' }]);
    });
  });

  describe('draining', () => {
    it('admits no Ticket while the ticket group drains, lets the running one finish, then copies; an Idée’s Phase is not held', async () => {
      await tickets(12, 14);
      const socket = await online();
      const running = await admit('12');
      const migration = await migrated('ticket', 'github');
      const held = await admit('14');
      expect(held).toMatchObject({ state: 'waiting', waitingOn: 'source-migration' });
      expect(await stepRunCount(held.id)).toBe(0);
      const idea = await admitIdea('idee-1');
      expect(idea.state).toBe('running');
      await migrations.idle();
      expect((await row(migration.id))?.state).toBe('draining');
      expect(socket.received().map((message) => message.type)).not.toContain('migration.copy');

      await stop(running.id);
      await expect(socket.expect('migration.copy')).resolves.toMatchObject({ migrationId: migration.id, group: 'ticket', from: 'local', to: 'github' });
      expect(await row(migration.id)).toMatchObject({ state: 'copying' });
      expect(await phaseRun(held.id)).toEqual({ state: 'waiting', waiting_on: 'source-migration' });
      expect(await ticketSource()).toBe('local');
    });

    it('waits for the work waiting on the Pilote too, and names it', async () => {
      await tickets(12);
      await online();
      const run = await admit('12');
      await sql(`UPDATE phase_runs SET state = 'waiting', waiting_on = 'decision' WHERE id = $1`, [run.id]);
      const migration = await migrated('ticket', 'github');
      await migrations.idle();
      expect(await row(migration.id)).toMatchObject({ state: 'draining' });
      expect((await state()).sourceMigrations).toEqual([expect.objectContaining({ id: migration.id, waitingItems: [{ itemType: 'ticket', number: 12 }] })]);
    });

    it('holds the next of a Phase without forEach by its own version’s Phase, not the finished one’s', async () => {
      const delivery = (inputs: ProcessDefinition['steps'][number]['inputs']): ProcessDefinition => ({
        ...PROCESS_CREWDECK,
        phases: [...PROCESS_CREWDECK.phases, { id: 'ph-livraison', name: 'Livraison', col: 1, row: 4, forEach: null }],
        steps: [...PROCESS_CREWDECK.steps, { id: 'st-lancer', phaseId: 'ph-livraison', kind: 'command', name: 'Lancer', col: 1, row: 1, inputs, outputs: [{ id: 'livraison', type: 'delivery' }], tools: [] }],
      });
      // v2: « Livraison » takes the code only; v3, activated meanwhile, also reads a Ticket.
      const v2 = await writeVersion(delivery([{ id: 'changement', type: 'code-change' }]));
      const v3 = await writeVersion(delivery([{ id: 'changement', type: 'code-change' }, { id: 'ticket', type: 'ticket' }]));
      const first = await insertRun(v2, 'ph-livraison', 'code-change', '57', 'running', null);
      const next = await insertRun(v3, 'ph-livraison', 'code-change', '58', 'waiting', 'queue');
      await tickets(12);
      const socket = await online();
      const migration = await migrated('ticket', 'github');
      await socket.expect('migration.copy');

      await stop(first);
      expect(await phaseRun(next)).toEqual({ state: 'waiting', waiting_on: 'source-migration' });
      expect(await stepRunCount(next)).toBe(0);
      expect((await row(migration.id))?.state).toBe('copying');
    });

    it('resumes, at the sweep, a migration left draining by a restart with nothing left to wait for', async () => {
      const id = newId();
      await sql(`INSERT INTO source_migrations (id, pilot_id, project_id, "group", "from", "to", state, waiting_items, created_at) VALUES ($1, $2, $3, 'ticket', 'local', 'github', 'draining', '[]', now())`, [id, alice.id, projectId]);
      await app.get(FinishSweep).sweep();
      await migrations.idle();
      expect(await row(id)).toMatchObject({ state: 'done' });
      expect(await ticketSource()).toBe('github');
    });

    it('switches a group that holds nothing and makes it done at once, with no message to the Runner', async () => {
      const socket = await online();
      const before = await lastSeq();
      const migration = await migrated('ticket', 'github');
      await migrations.idle();
      expect(await row(migration.id)).toMatchObject({ state: 'done' });
      expect(await ticketSource()).toBe('github');
      const events = await eventsSince(before);
      const done = events.find((event) => event.type === 'source-migration.upserted' && event.payload['state'] === 'done');
      expect(done?.payload).toMatchObject({ switchedAt: expect.any(String), endedAt: expect.any(String) });
      const process = events.find((event) => event.type === 'process.upserted');
      expect(process?.tx).toBe(done?.tx);
      expect(process?.payload).toMatchObject({ sources: { ticket: { source: 'github' } } });
      expect(socket.received().map((message) => message.type).filter((type) => type.startsWith('migration.'))).toEqual([]);
    });
  });

  describe('the switch', () => {
    it('writes the Source, the state, the hooks’ rows and the events in one transaction, then sends migration.finish; the held work starts once the old place is frozen', async () => {
      const { migration, socket } = await copying();
      const held = await admit('14');
      expect(held.waitingOn).toBe('source-migration');
      socket.send({ type: 'migration.progress', migrationId: migration.id, total: 2, copied: 1, state: 'copying' });
      await vi.waitFor(async () => expect((await state()).sourceMigrations[0]).toMatchObject({ total: 2, copied: 1 }));
      const before = await lastSeq();
      socket.send({ type: 'migration.switch', migrationId: migration.id, fingerprints: [FINGERPRINT], renumbering: [{ from: 12, to: 57 }] });
      await expect(socket.expect('migration.finish')).resolves.toMatchObject({ migrationId: migration.id, fingerprints: [FINGERPRINT] });
      expect(await row(migration.id)).toMatchObject({ state: 'switched', fingerprints: [FINGERPRINT] });
      expect(await ticketSource()).toBe('github');
      expect(hookCalls).toEqual([`${migration.id}:1`]);
      const events = await eventsSince(before);
      const switched = events.find((event) => event.type === 'source-migration.upserted');
      expect(switched?.payload).toMatchObject({ state: 'switched' });
      for (const type of ['process.upserted', 'project.upserted']) expect(events.find((event) => event.type === type)?.tx).toBe(switched?.tx);
      expect(await sql<{ source: string }>('SELECT DISTINCT source FROM tickets WHERE project_id = $1', [projectId])).toEqual([{ source: 'github' }]);
      expect(await phaseRun(held.id)).toEqual({ state: 'waiting', waiting_on: 'source-migration' });
      expect(await stepRunCount(held.id)).toBe(0);
      expect((await admit('15')).waitingOn).toBe('source-migration');

      socket.send({ type: 'migration.finished', migrationId: migration.id });
      await vi.waitFor(async () => expect((await row(migration.id))?.state).toBe('done'));
      expect(await phaseRun(held.id)).toEqual({ state: 'running', waiting_on: null });
    });

    it('refuses an activation confirmed before the switch (sensitive-action.stale): the Process it showed changed', async () => {
      const { migration, socket } = await copying();
      const now = zProjectProcess.parse(await (await call('GET', `/api/projects/${projectId}/process`)).json());
      const definition = structuredClone(now.active!.definition);
      definition.loopBacks[0]!.max += 2;
      const saved = await call('PUT', `/api/projects/${projectId}/process/draft`, { definition, sealed: null, revision: 0, baseVersion: now.active!.number });
      const { revision } = zProjectProcess.parse(await saved.json()).draft!;
      // The dialog opens here: the seq the page holds.
      const confirmed = await lastSeq();

      socket.send({ type: 'migration.switch', migrationId: migration.id, fingerprints: [FINGERPRINT], renumbering: [] });
      await expect(socket.expect('migration.finish')).resolves.toMatchObject({ migrationId: migration.id });

      await expectEnvelope(await call('POST', `/api/projects/${projectId}/process/activate`, { revision, seq: confirmed }), 409, 'sensitive-action.stale');
      const after = zProjectProcess.parse(await (await call('GET', `/api/projects/${projectId}/process`)).json());
      expect(after.active?.number).toBe(now.active!.number);
      expect(after.draft?.revision).toBe(revision);
    });

    it('rolls the whole switch back when a hook throws, then fails the migration on the old Source (switch-failed)', async () => {
      const { migration, socket } = await copying();
      hookMode = 'throw';
      socket.send({ type: 'migration.switch', migrationId: migration.id, fingerprints: [FINGERPRINT], renumbering: [] });
      await vi.waitFor(async () => expect((await row(migration.id))?.state).toBe('failed'));
      expect(await row(migration.id)).toMatchObject({ error_code: 'source-migration.switch-failed', fingerprints: [] });
      expect(await ticketSource()).toBe('local');
      expect(await sql<{ source: string }>('SELECT DISTINCT source FROM tickets WHERE project_id = $1', [projectId])).toEqual([{ source: 'github' }]);
      expect((await openDecisions()).map((decision) => decision.kind)).toEqual(['source-migration.failed']);
    });
  });

  describe('failures', () => {
    it('fails before the switch: the Décision with its params, the held work on the old Source; « Réessayer » copies again with attempt 2', async () => {
      const { migration, socket } = await copying();
      const held = await admit('14');
      socket.send({ type: 'migration.failed', migrationId: migration.id, stage: 'copy', code: 'github.unavailable' });
      await vi.waitFor(async () => expect((await row(migration.id))?.state).toBe('failed'));
      expect(await row(migration.id)).toMatchObject({ error_code: 'github.unavailable' });
      expect(await ticketSource()).toBe('local');
      expect(await phaseRun(held.id)).toEqual({ state: 'running', waiting_on: null });
      const [decision] = await openDecisions();
      expect(decision).toMatchObject({
        kind: 'source-migration.failed',
        label: 'Ticket de fixture-app',
        meta_parts: ['Sources'],
        tone: 'halt',
        link: `/projets/${projectId}/process?onglet=sources`,
        params: { migrationId: migration.id, group: 'ticket', from: 'local', to: 'github', code: 'github.unavailable' },
      });
      expect(zDecision.shape.kind.parse(decision?.kind)).toBe('source-migration.failed');

      const failedSeq = (await state()).sourceMigrations.find((item) => item.id === migration.id);
      expect(failedSeq?.state).toBe('failed');
      await expectEnvelope(await call('POST', `/api/source-migrations/${migration.id}/retry`, { seq: '1' }), 409, 'realtime.stale');
      await expectEnvelope(await call('POST', `/api/source-migrations/${newId()}/retry`, { seq: await lastSeq() }), 404, 'source-migration.not-found');
      await stop(held.id);
      const retried = await call('POST', `/api/source-migrations/${migration.id}/retry`, { seq: await lastSeq() });
      expect(retried.status).toBe(200);
      expect(zSourceMigration.parse(await retried.json())).toMatchObject({ state: 'draining', attempt: 2, errorCode: null });
      await expect(socket.expect('migration.copy')).resolves.toMatchObject({ migrationId: migration.id });
      expect(await row(migration.id)).toMatchObject({ state: 'copying', attempt: 2 });
      expect(await openDecisions()).toEqual([]);
      await expectEnvelope(await call('POST', `/api/source-migrations/${migration.id}/retry`, { seq: await lastSeq() }), 422, 'source-migration.not-failed');
    });

    it('refuses to retry a failed migration another one replaced, even once that one is done', async () => {
      const { migration, socket } = await copying();
      socket.send({ type: 'migration.failed', migrationId: migration.id, stage: 'copy', code: 'github.unavailable' });
      await vi.waitFor(async () => expect((await row(migration.id))?.state).toBe('failed'));
      const replacing = await migrated('ticket', 'github');
      await socket.expect('migration.copy');
      socket.send({ type: 'migration.switch', migrationId: replacing.id, fingerprints: [FINGERPRINT], renumbering: [] });
      await socket.expect('migration.finish');
      socket.send({ type: 'migration.finished', migrationId: replacing.id });
      await vi.waitFor(async () => expect((await row(replacing.id))?.state).toBe('done'));

      await expectEnvelope(await call('POST', `/api/source-migrations/${migration.id}/retry`, { seq: await lastSeq() }), 422, 'source-migration.replaced');
      expect(await row(migration.id)).toMatchObject({ state: 'failed', attempt: 1 });
      expect(socket.received().filter((message) => message.type === 'migration.copy')).toHaveLength(2);
    });

    it('a new migration resolves a failed one’s Décision (replaced)', async () => {
      const { migration, socket } = await copying();
      socket.send({ type: 'migration.failed', migrationId: migration.id, stage: 'copy', code: 'github.unavailable' });
      await vi.waitFor(async () => expect((await row(migration.id))?.state).toBe('failed'));
      await migrated('code', 'local');
      expect((await openDecisions()).map((decision) => decision.kind)).not.toContain('source-migration.failed');
      expect(await sql(`SELECT outcome FROM decisions WHERE kind = 'source-migration.failed'`)).toEqual([{ outcome: 'replaced' }]);
    });

    it('raises source-migration.unfinished at the third failure of finishing, keeps the new Source; migration.finished resolves it', async () => {
      const { migration, socket } = await copying();
      socket.send({ type: 'migration.switch', migrationId: migration.id, fingerprints: [FINGERPRINT], renumbering: [] });
      await socket.expect('migration.finish');
      const sweep = app.get(FinishSweep);
      const now = Date.now();
      for (const [index, minutes] of [1, 5].entries()) {
        socket.send({ type: 'migration.failed', migrationId: migration.id, stage: 'finish', code: 'runner.io' });
        await vi.waitFor(async () => expect((await row(migration.id))?.finish_tries).toBe(index + 1));
        expect(await sweep.sweep(new Date(now + (minutes - 0.5) * 60_000))).toBe(0);
        expect(await sweep.sweep(new Date(now + (minutes + 0.5) * 60_000 + index * 60_000))).toBe(1);
        await socket.expect('migration.finish');
        expect(await openDecisions()).toEqual([]);
      }
      socket.send({ type: 'migration.failed', migrationId: migration.id, stage: 'finish', code: 'runner.io' });
      await vi.waitFor(async () => expect((await openDecisions()).map((decision) => decision.kind)).toEqual(['source-migration.unfinished']));
      expect((await openDecisions())[0]).toMatchObject({ tone: 'caution', meta_parts: ['tickets/ pas encore archivé'] });
      expect(await row(migration.id)).toMatchObject({ state: 'switched', finish_tries: 3 });
      expect(await ticketSource()).toBe('github');

      socket.send({ type: 'migration.finished', migrationId: migration.id });
      await vi.waitFor(async () => expect((await row(migration.id))?.state).toBe('done'));
      expect(await openDecisions()).toEqual([]);
    });

    it('fails a migration a reconnected Runner cannot copy', async () => {
      const { migration, socket } = await copying();
      await socket.close();
      await online(['code']);
      await vi.waitFor(async () => expect((await row(migration.id))?.state).toBe('failed'));
      expect(await row(migration.id)).toMatchObject({ error_code: 'source-migration.runner-cannot-migrate' });
    });
  });

  it('sends migration.copy again to a Runner reconnecting while copying', async () => {
    const { migration, socket } = await copying();
    await socket.close();
    const again = await online();
    await expect(again.expect('migration.copy')).resolves.toMatchObject({ migrationId: migration.id, group: 'ticket' });
  });

  it('lists the Projet’s migrations, the newest first, by state, 404 for another Pilote’s Projet; the Tickets go back Local to the folder they left', async () => {
    const first = await migrated('ticket', 'github');
    await migrations.idle();
    // No group Local any more, the code on GitHub: the folder the Tickets left is still the Projet's.
    expect(await sql('SELECT "group", source FROM artifact_sources WHERE project_id = $1 ORDER BY "group"::text', [projectId])).toEqual([{ group: 'code', source: 'github' }, { group: 'ticket', source: 'github' }]);
    const second = await migrated('ticket', 'local');
    await migrations.idle();
    const page = zSourceMigrationPage.parse(await (await call('GET', `/api/projects/${projectId}/source-migrations?limit=1`)).json());
    expect(page.items.map((item) => item.id)).toEqual([second.id]);
    const next = zSourceMigrationPage.parse(await (await call('GET', `/api/projects/${projectId}/source-migrations?limit=1&cursor=${page.nextCursor ?? ''}`)).json());
    expect(next).toEqual({ items: [expect.objectContaining({ id: first.id })], nextCursor: null });
    const done = zSourceMigrationPage.parse(await (await call('GET', `/api/projects/${projectId}/source-migrations?state=failed`)).json());
    expect(done.items).toEqual([]);
    await expectEnvelope(await call('GET', `/api/projects/${newId()}/source-migrations`), 404, 'project.not-found');
    expect((await state()).sourceMigrations.map((item) => item.id)).toEqual([second.id]);
  });
});
