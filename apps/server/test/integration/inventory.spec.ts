import { type Capabilities, type Decision, projectFolderAad, projectNameAad, zDecision, zProject, zProjectList, zState } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { WebhookDispatcher } from '../../src/github/webhooks/dispatcher.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { InventoryBoot } from '../../src/projects/inventory/inventory.boot.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import { createAiAccounts, createLinkedRunner } from '../../src/testing/runners.js';
import { sealItem } from '../../src/testing/vault.js';
import { deliverWebhook, TEST_WEBHOOK_SECRET, webhookFixture } from '../fakes/github.js';
import { connectRunner, type FakeRunnerClient } from '../fakes/runner.js';
import { authKeysEnv } from '../github-app.js';
import { expectFields, startApp } from '../route-baseline.js';

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

/** Every row of every table, as text: what a reader of the database would see. */
const database = async (): Promise<string> => {
  const tables = await sql<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  const dumps = await Promise.all(tables.map(({ tablename }) => sql<{ row: string }>(`SELECT row_to_json(t)::text AS row FROM "${tablename}" t`)));
  return dumps.flat().map(({ row }) => row).join('\n');
};

const SENDER_ID = 9100001;
const INSTALLATION_ID = 51000001;
const created = webhookFixture<Record<string, unknown>>('installation.created');
const REPO = { owner: 'octo-fixture', name: 'courtside', id: 71000001 };
const SHA = 'c'.repeat(40);
const FIGURES = { glossaryTerms: 12, technicalChoices: 4, apps: 2, screens: 9 };
/** A line of a glossary: what the server must never hold. */
const GLOSSARY_LINE = '**Créneau** (`Slot`): une heure de court réservable';

/** Claude Code by subscription, Opus usable: the Rôle Conception's default. */
const ENGINES: Capabilities['engines'] = [
  {
    engine: 'claude-code',
    installed: true,
    version: '2.1.3',
    knownVersion: true,
    account: { kind: 'subscription', state: 'connected' },
    models: [{ id: 'opus', label: 'Opus', usable: true }],
    features: { interrupt: true, resume: true, questions: true, permissions: true },
  },
];

const verdict = (status: 'passed' | 'incomplete', failedRuleIds: string[] = []) => ({ contractId: 'inventory', version: 1, status, failedRuleIds, warningRuleIds: [], headSha: SHA });

interface PhaseRunRow {
  id: string;
  project_id: string | null;
  process_version_id: string | null;
  builtin_template: string | null;
  phase_id: string;
  item_type: string;
  item_id: string;
  state: string;
}

describe('the Inventaire of an existing code against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let fakes: Fakes;
  let alice: { id: string; cookie: string; runnerToken: string };
  const sockets: FakeRunnerClient[] = [];
  const vaultKey = randomBytes(32);

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    prisma = app.get(PrismaService);
    fakes = app.get<Fakes>(FAKES);
  });

  /** A Runner's socket closed by the last test may still be interrupting its Sessions: a deadlock is retried. */
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

  beforeEach(async () => {
    await empty();
    fakes.github.reset();
    // Two commits on its release branch: a repository with code.
    const ref = fakes.github.seedRepo({ ...REPO, installationId: INSTALLATION_ID, defaultBranch: 'trunk', files: { 'README.md': '# Courtside' } });
    await fakes.github.pushCommit(ref, 'trunk', { 'src/app.ts': 'export {};' });
    const id = newId();
    await sql(
      `WITH p AS (INSERT INTO pilots (id, display_name, time_zone, getting_started_step, vault_key_version) VALUES ($1, 'octo-fixture', 'Europe/Paris', 'projects', 1) RETURNING id) INSERT INTO pilot_identities (id, pilot_id, provider, subject, login) SELECT gen_random_uuid(), id, 'github', $2::text, 'octo-fixture' FROM p`,
      [id, SENDER_ID],
    );
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    const runner = await createLinkedRunner(prisma, id);
    alice = { id, cookie: `${SESSION_COOKIE}=${token}`, runnerToken: runner.token };
    expect((await deliverWebhook(url, { event: 'installation', payload: created })).status).toBe(202);
    await app.get(WebhookDispatcher).settled();
  });

  const call = (method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method,
      headers: { cookie: alice.cookie, origin: ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const state = async () => zState.parse(await (await call('GET', '/api/state')).json());
  const decisions = async (): Promise<Decision[]> => (await state()).decisions.map((decision) => zDecision.parse(decision));

  const online = async (): Promise<FakeRunnerClient> => {
    const socket = await connectRunner(url, alice.runnerToken);
    sockets.push(socket);
    socket.hello({});
    await socket.expect('hello.accepted');
    return socket;
  };
  const withMoteur = () => createAiAccounts(prisma, alice.id, ENGINES);

  /** The repository followed on « Process Crewdeck »: the Projet as the route returns it. */
  const follow = async () => {
    const { seq, repositories } = await state();
    const res = await call('POST', '/api/projects', { repositoryIds: repositories.map((repository) => repository.id), templateId: 'process-crewdeck', seq: String(seq) });
    expect(res.status).toBe(201);
    const project = zProjectList.parse(await res.json()).items[0];
    if (!project) throw new Error('No Projet followed');
    return project;
  };

  const phaseRuns = (projectId: string) =>
    sql<PhaseRunRow>('SELECT id, project_id, process_version_id, builtin_template, phase_id, item_type, item_id, state FROM phase_runs WHERE project_id = $1 ORDER BY id', [projectId]);
  const inventory = async (projectId: string) => {
    const [row] = await sql<{ inventory_state: string; inventory_head_sha: string | null; inventory_figures: unknown }>(
      'SELECT inventory_state, inventory_head_sha, inventory_figures FROM projects WHERE id = $1',
      [projectId],
    );
    return row;
  };
  const stepRun = async (phaseRunId: string) => {
    const [row] = await sql<{ id: string; step_id: string; kind: string; state: string; failure: string | null; session_id: string | null; outputs: unknown }>(
      'SELECT id, step_id, kind, state, failure, session_id, outputs FROM step_runs WHERE phase_run_id = $1',
      [phaseRunId],
    );
    if (!row) throw new Error('No StepRun');
    return row;
  };

  /** A repository with code followed, Runner online, a Moteur for the Rôle Conception: its Inventaire's Session started. */
  const drafting = async () => {
    const socket = await online();
    await withMoteur();
    const project = await follow();
    const start = await socket.expect('session.start');
    const [run] = await phaseRuns(project.id);
    if (!run) throw new Error('No PhaseRun');
    return { socket, project, start, run, step: await stepRun(run.id) };
  };

  const end = (socket: FakeRunnerClient, sessionId: string) => socket.send({ type: 'session.state', sessionId, state: 'ended', outcome: 'ok' });

  it('admits one « Préparation » PhaseRun for a repository with code: st-inventory’s Session on crewdeck/inventaire from the release branch, in the Rôle Conception’s Moteur and model; the Projet drafting', async () => {
    const { project, start, run, step } = await drafting();

    expect(project.inventoryState).toBe('drafting');
    expect(await phaseRuns(project.id)).toEqual([
      { id: run.id, project_id: project.id, process_version_id: null, builtin_template: 'preparation', phase_id: 'ph-preparation', item_type: 'inventory', item_id: project.id, state: 'running' },
    ]);
    expect(step).toMatchObject({ step_id: 'st-inventory', kind: 'inventory', state: 'running', session_id: start.sessionId });
    expect(start).toMatchObject({
      projectId: project.id,
      role: 'design',
      engine: 'claude-code',
      model: 'opus',
      branch: 'crewdeck/inventaire',
      base: 'trunk',
      title: 'Inventaire',
      origin: { kind: 'github', owner: REPO.owner, name: REPO.name },
      step: { stepRunId: step.id, stepKind: 'inventory', skill: 'inventory', contractId: 'inventory', inputs: [] },
    });
    const { projects, phaseRuns: slice } = await state();
    expect(projects.find((candidate) => candidate.id === project.id)?.inventoryState).toBe('drafting');
    expect(slice.find((candidate) => candidate.id === run.id)).toMatchObject({ builtinTemplate: 'preparation', processVersion: null, itemType: 'inventory' });
  });

  it('makes the Projet to-approve on the report and a passed verdict: its head SHA and figures, its output, « Inventaire à approuver » in « À toi »', async () => {
    const { socket, project, start, run, step } = await drafting();

    socket.send({ type: 'step.started', stepRunId: step.id });
    socket.send({ type: 'step.report', stepRunId: step.id, figures: FIGURES });
    socket.send({ type: 'step.verdict', stepRunId: step.id, verdict: verdict('passed') });
    end(socket, start.sessionId);

    await vi.waitFor(async () => expect((await inventory(project.id))?.inventory_state).toBe('to-approve'));
    expect(await inventory(project.id)).toEqual({ inventory_state: 'to-approve', inventory_head_sha: SHA, inventory_figures: FIGURES });
    expect(await stepRun(run.id)).toMatchObject({ state: 'done', outputs: [{ portId: 'inventaire', type: 'inventory', id: project.id, sha: SHA }] });
    const review = (await decisions()).find((decision) => decision.kind === 'inventory-review');
    expect(review).toMatchObject({
      projectId: project.id,
      projectName: project.displayName,
      subjectType: 'project',
      subjectId: project.id,
      label: project.displayName,
      metaParts: ['Projet existant'],
      tone: 'accent',
      link: `/projets/${project.id}`,
      state: 'open',
    });
    expect((await state()).projects.find((candidate) => candidate.id === project.id)?.inventoryState).toBe('to-approve');
  });

  it('keeps the Projet drafting on an incomplete verdict, with no inventory-review', async () => {
    const { socket, project, start, run, step } = await drafting();

    socket.send({ type: 'step.verdict', stepRunId: step.id, verdict: verdict('incomplete', ['inventory.glossary.terms']) });
    end(socket, start.sessionId);

    await vi.waitFor(async () => expect((await stepRun(run.id)).state).toBe('failed'));
    expect(await inventory(project.id)).toEqual({ inventory_state: 'drafting', inventory_head_sha: null, inventory_figures: null });
    const open = await decisions();
    expect(open.map((decision) => decision.kind)).toEqual(['contract-incomplete']);
  });

  it('leaves a Projet pending while the Rôle Conception has no Moteur, and starts it once the Runner reports one', async () => {
    const socket = await online();
    const project = await follow();

    expect(project.inventoryState).toBe('pending');
    expect(await phaseRuns(project.id)).toEqual([]);

    socket.send({ type: 'capabilities', engines: ENGINES });

    expect(await socket.expect('session.start')).toMatchObject({ projectId: project.id, branch: 'crewdeck/inventaire', step: { stepKind: 'inventory' } });
    await vi.waitFor(async () => expect((await inventory(project.id))?.inventory_state).toBe('drafting'));
    expect(await phaseRuns(project.id)).toHaveLength(1);
  });

  it('starts at boot the Inventaire of a Projet still pending, once', async () => {
    const project = await follow();
    expect(await phaseRuns(project.id)).toEqual([]);
    await withMoteur();

    expect(await app.get(InventoryBoot).run()).toBe(1);

    expect(await phaseRuns(project.id)).toEqual([expect.objectContaining({ builtin_template: 'preparation', phase_id: 'ph-preparation' })]);
    expect((await inventory(project.id))?.inventory_state).toBe('drafting');
    expect(await app.get(InventoryBoot).run()).toBe(0);
  });

  it('gives a Local Projet with code its PhaseRun only once its folder is present, its Session on the Local origin', async () => {
    const socket = await online();
    await withMoteur();
    const id = newId();
    const res = await call('POST', '/api/projects/local', {
      id,
      nameSealed: sealItem(vaultKey, 'Courtside', projectNameAad(id)),
      folderSealed: sealItem(vaultKey, JSON.stringify({ path: '/home/pilote/courtside' }), projectFolderAad(id)),
      vaultKeyVersion: 1,
      hasCode: true,
      releaseBranch: 'trunk',
      templateId: 'process-crewdeck',
    });
    expect(res.status).toBe(201);
    expect(zProject.parse(await res.json())).toMatchObject({ folder: 'pending', inventoryState: 'pending' });
    await socket.expect('project.folder.attach');
    expect(await phaseRuns(id)).toEqual([]);

    socket.send({ type: 'projects.folders', present: [id] });

    expect(await socket.expect('session.start')).toMatchObject({ projectId: id, branch: 'crewdeck/inventaire', base: 'trunk', origin: { kind: 'local' }, step: { stepKind: 'inventory' } });
    await vi.waitFor(async () => expect((await inventory(id))?.inventory_state).toBe('drafting'));
    expect(await phaseRuns(id)).toEqual([expect.objectContaining({ builtin_template: 'preparation', item_type: 'inventory', item_id: id })]);
  });

  it('does not offer « Préparation » as a Modèle de process', async () => {
    const { seq, repositories } = await state();
    await expectFields(
      await call('POST', '/api/projects', { repositoryIds: repositories.map((repository) => repository.id), templateId: 'preparation', seq: String(seq) }),
      ['templateId'],
    );
    expect(await sql('SELECT id FROM projects')).toEqual([]);
  });

  it('holds no text of the Inventaire: counts and a SHA on the Projet, a report carrying text refused and stored nowhere', async () => {
    const { socket, project, start, run, step } = await drafting();

    socket.send({ type: 'step.report', stepRunId: step.id, figures: { ...FIGURES, glossary: GLOSSARY_LINE } });
    socket.send({ type: 'step.verdict', stepRunId: step.id, verdict: verdict('passed') });
    end(socket, start.sessionId);

    await vi.waitFor(async () => expect((await stepRun(run.id)).state).toBe('failed'));
    expect(await inventory(project.id)).toEqual({ inventory_state: 'drafting', inventory_head_sha: null, inventory_figures: null });
    const dump = await database();
    expect(dump).not.toContain('Créneau');
    expect(dump).not.toContain('Slot');
  });
});
