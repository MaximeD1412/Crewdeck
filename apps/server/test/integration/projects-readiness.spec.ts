import { type EngineCapabilities, PROCESS_CREWDECK, PROCESS_LABELS, type Project, type ProcessDefinition, projectFolderAad, projectNameAad, type ReadinessCheck, zProject, zState } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { Reconciliation } from '../../src/github/reconciliation/reconciliation.service.js';
import { WebhookDispatcher } from '../../src/github/webhooks/dispatcher.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { RunnerPresence } from '../../src/runners/runner-presence.service.js';
import { ReadinessService } from '../../src/projects/readiness/readiness.service.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
import { sealItem } from '../../src/testing/vault.js';
import { deliverWebhook, TEST_WEBHOOK_SECRET, webhookFixture } from '../fakes/github.js';
import { connectRunner, type FakeRunnerClient } from '../fakes/runner.js';
import { connect, type WsClient } from '../fakes/ws-client.js';
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
// The installation's two repositories: the readiness reads the one without code (no Inventaire to approve).
const APP_REPO = { owner: 'octo-fixture', name: 'fixture-app', id: 71000001 };
const NEW_REPO = { owner: 'octo-fixture', name: 'new-idea', id: 71000002 };

const CLAUDE_CONNECTED: EngineCapabilities = {
  engine: 'claude-code',
  installed: true,
  version: '2.1.319',
  knownVersion: true,
  account: { kind: 'subscription', state: 'connected' },
  models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', usable: true }],
  features: { interrupt: true, resume: true, questions: true, permissions: true },
};

interface Pilot {
  id: string;
  cookie: string;
  token: string;
}

const checkOf = (project: Project, id: ReadinessCheck['id']): ReadinessCheck | undefined => project.readiness?.checks.find((check) => check.id === id);

describe('the readiness of a Projet against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let fakes: Fakes;
  let readiness: ReadinessService;
  const closers: (WsClient | FakeRunnerClient)[] = [];
  const vaultKey = randomBytes(32);

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    prisma = app.get(PrismaService);
    fakes = app.get<Fakes>(FAKES);
    readiness = app.get(ReadinessService);
  });

  const empty = () => sql('TRUNCATE pilots, github_installations, github_deliveries CASCADE');

  afterAll(async () => {
    await empty();
    await app.close();
  });

  beforeEach(async () => {
    await empty();
    fakes.github.reset();
    fakes.github.seedRepo({ ...APP_REPO, installationId: INSTALLATION_ID, files: { 'README.md': '# App' } });
    await fakes.github.pushCommit(APP_REPO, 'main', { 'src/main.ts': 'code' });
    fakes.github.seedRepo({ ...NEW_REPO, installationId: INSTALLATION_ID, files: { 'README.md': '# New' } });
  });

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((closer) => closer.close()));
  });

  const pilot = async (login: string, githubUserId?: number): Promise<Pilot> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, display_name, time_zone, getting_started_step, vault_key_version) VALUES ($1, $2, 'Europe/Paris', 'projects', 1)`, [id, login]);
    if (githubUserId !== undefined) {
      await sql(`INSERT INTO pilot_identities (id, pilot_id, provider, subject, login) VALUES ($1, $2, 'github', $3, $4)`, [newId(), id, String(githubUserId), login]);
    }
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    const runner = await createLinkedRunner(prisma, id);
    return { id, cookie: `${SESSION_COOKIE}=${token}`, token: runner.token };
  };

  const online = async ({ token }: Pilot): Promise<FakeRunnerClient> => {
    const socket = await connectRunner(url, token);
    closers.push(socket);
    socket.hello({ machine: 'atelier' });
    await socket.expect('hello.accepted');
    await readiness.settled();
    return socket;
  };

  /** A tab of the Pilote's, live from the state it read. */
  const tab = async (who: Pilot): Promise<WsClient> => {
    const lastSeq = Number((await state(who)).seq);
    const client = await connect(url, { cookie: who.cookie, origin: ORIGIN });
    closers.push(client);
    client.send({ type: 'hello', lastSeq });
    await client.next('live');
    return client;
  };

  const call = (who: Pilot | undefined, path: string, body?: unknown, method = 'POST'): Promise<Response> =>
    fetch(`${url}${path}`, {
      method: body === undefined ? 'GET' : method,
      headers: { ...(who ? { cookie: who.cookie } : {}), origin: ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    });

  const state = async (who: Pilot) => zState.parse(await (await call(who, '/api/state')).json());
  const projectOf = async (who: Pilot, id: string) => zProject.parse(await (await call(who, `/api/projects/${id}`)).json());
  const fix = async (who: Pilot, id: string, checkId: string, seq?: string) => call(who, `/api/projects/${id}/fixes/${checkId}`, { seq: seq ?? (await state(who)).seq });

  const deliver = async (event: string, payload: unknown): Promise<void> => {
    const res = await deliverWebhook(url, { event, payload });
    expect(res.status).toBe(202);
    await app.get(WebhookDispatcher).settled();
    await readiness.settled();
  };

  const repositoryPayload = (repo: { owner: string; name: string; id: number }) => ({
    id: repo.id,
    name: repo.name,
    full_name: `${repo.owner}/${repo.name}`,
    private: true,
    owner: { login: repo.owner },
  });

  /** Alice's GitHub Projet of `new-idea` (no code), followed with « Process Crewdeck ». */
  const githubProject = async (who: Pilot): Promise<Project> => {
    await deliver('installation', created);
    const repository = (await state(who)).repositories.find((candidate) => candidate.name === NEW_REPO.name);
    const res = await call(who, '/api/projects', { repositoryIds: [repository?.id], templateId: 'process-crewdeck', seq: (await state(who)).seq });
    expect(res.status).toBe(201);
    await readiness.settled();
    const [project] = (await state(who)).projects;
    return project!;
  };

  /** A Local Projet, its Runner having stored its folder; resolves with its id and the Runner's `project.folder.status`. */
  const localProject = async (who: Pilot, runner: FakeRunnerClient, fields: Record<string, unknown> = {}) => {
    const id = newId();
    const body = {
      id,
      nameSealed: sealItem(vaultKey, 'Recettes', projectNameAad(id)),
      folderSealed: sealItem(vaultKey, JSON.stringify({ path: '/srv/projets/recettes' }), projectFolderAad(id)),
      vaultKeyVersion: 1,
      hasCode: false,
      releaseBranch: 'main',
      templateId: 'process-crewdeck',
      ...fields,
    };
    expect((await call(who, '/api/projects/local', body)).status).toBe(201);
    await runner.expect('project.folder.attach');
    runner.send({ type: 'projects.folders', present: [id] });
    const status = await runner.expect('project.folder.status');
    return { id, status };
  };

  const folderState = (projectId: string, figures: Partial<Record<'present' | 'isGit' | 'hasCommits' | 'releaseBranch' | 'integrationBranch', boolean>>) => ({
    type: 'project.folder.state' as const,
    projectId,
    present: true,
    isGit: true,
    hasCommits: true,
    releaseBranch: true,
    integrationBranch: true,
    ...figures,
  });

  /** Waits until `check` passes, the server's handling of a Runner's message being asynchronous. */
  const eventually = async (check: () => Promise<void>): Promise<void> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await readiness.settled();
        return await check();
      } catch (error) {
        if (attempt === 50) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  };

  const noProcessJson = () => expect(JSON.stringify(fakes.github.calls)).not.toContain('.process.json');

  describe('a GitHub Projet', () => {
    it('without its integration branch cannot start; « Corriger » creates develop from main on GitHub and the row turns ok, as project.upserted', async () => {
      const alice = await pilot('octo-fixture', SENDER_ID);
      await online(alice);
      const project = await githubProject(alice);

      expect(project.readiness?.ready).toBe(false);
      expect(checkOf(project, 'branches')).toEqual({
        id: 'branches',
        state: 'missing',
        facts: { release: 'main', integration: 'develop', releaseExists: true, integrationExists: false },
        fix: 'auto',
      });
      const main = await fakes.github.getBranch({ ...NEW_REPO }, 'main');
      const ws = await tab(alice);
      fakes.github.calls.length = 0;

      const res = await fix(alice, project.id, 'branches');

      expect(res.status).toBe(200);
      const fixed = zProject.parse(await res.json());
      expect(checkOf(fixed, 'branches')).toMatchObject({ state: 'ok', fix: null });
      expect(fakes.github.calls.filter((call) => call.method === 'createBranch').map((call) => call.args.slice(1))).toEqual([['develop', main?.sha]]);
      const event = await ws.next('event');
      expect(event).toMatchObject({ event: { type: 'project.upserted', payload: { id: project.id } } });
      expect(checkOf(zProject.parse((event as { event: { payload: unknown } }).event.payload), 'branches')?.state).toBe('ok');
      noProcessJson();
    });

    it('« Corriger » on the labels creates only the missing ones, the labels the Pilote already has kept', async () => {
      const alice = await pilot('octo-fixture', SENDER_ID);
      await online(alice);
      const [kept] = PROCESS_LABELS;
      await fakes.github.ensureLabel({ ...NEW_REPO }, { name: kept!.name, color: '000000', description: 'mine' });
      const project = await githubProject(alice);
      expect(checkOf(project, 'labels')).toEqual({ id: 'labels', state: 'missing', facts: { missing: PROCESS_LABELS.length - 1 }, fix: 'auto' });
      fakes.github.calls.length = 0;

      const fixed = zProject.parse(await (await fix(alice, project.id, 'labels')).json());

      expect(checkOf(fixed, 'labels')).toMatchObject({ state: 'ok', facts: { missing: 0 } });
      const ensured = fakes.github.calls.filter((call) => call.method === 'ensureLabel').map((call) => (call.args[1] as { name: string }).name);
      expect(ensured).toEqual(PROCESS_LABELS.slice(1).map((label) => label.name));
      expect((await fakes.github.listLabels({ ...NEW_REPO })).find((label) => label.name === kept!.name)?.description).toBe('mine');
      noProcessJson();
    });

    it('reads GitHub again on a push to its branch, a label webhook and the reconciliation, never otherwise', async () => {
      const alice = await pilot('octo-fixture', SENDER_ID);
      await online(alice);
      const project = await githubProject(alice);
      const repo = { ...NEW_REPO };
      const main = await fakes.github.getBranch(repo, 'main');

      await fakes.github.createBranch(repo, 'develop', main!.sha);
      expect(checkOf(await projectOf(alice, project.id), 'branches')?.state).toBe('missing');
      await deliver('push', { ref: 'refs/heads/develop', after: main!.sha, repository: repositoryPayload(NEW_REPO), installation: { id: INSTALLATION_ID } });
      expect(checkOf(await projectOf(alice, project.id), 'branches')?.state).toBe('ok');

      for (const label of PROCESS_LABELS.slice(0, 3)) await fakes.github.ensureLabel(repo, label);
      await deliver('label', { action: 'created', label: { name: PROCESS_LABELS[2]!.name }, repository: repositoryPayload(NEW_REPO), installation: { id: INSTALLATION_ID } });
      expect(checkOf(await projectOf(alice, project.id), 'labels')?.facts).toEqual({ missing: PROCESS_LABELS.length - 3 });

      for (const label of PROCESS_LABELS) await fakes.github.ensureLabel(repo, label);
      await app.get(Reconciliation).run();
      await readiness.settled();
      expect(checkOf(await projectOf(alice, project.id), 'labels')).toMatchObject({ state: 'ok' });
      noProcessJson();
    });

    it('is ready once every check is ok: a Runner linked, a usable Moteur for each Rôle, the labels and the branches there', async () => {
      const alice = await pilot('octo-fixture', SENDER_ID);
      const runner = await online(alice);
      const project = await githubProject(alice);
      expect(checkOf(project, 'engines')).toMatchObject({ state: 'missing', facts: { code: null }, fix: 'link' });

      runner.send({ type: 'capabilities', engines: [CLAUDE_CONNECTED] });

      await eventually(async () => expect(checkOf(await projectOf(alice, project.id), 'engines')).toMatchObject({ state: 'ok', facts: { code: 'claude-code' } }));
      await fix(alice, project.id, 'labels');
      const ready = zProject.parse(await (await fix(alice, project.id, 'branches')).json());

      expect(ready.readiness?.checks.map((check) => [check.id, check.state])).toEqual([
        ['runner-linked', 'ok'],
        ['engines', 'ok'],
        ['tools', 'ok'],
        ['process', 'ok'],
        ['labels', 'ok'],
        ['branches', 'ok'],
      ]);
      expect(ready.readiness?.ready).toBe(true);
    });

    it('reads the labels once its Tickets move to GitHub, the figures read while they were Local not kept', async () => {
      const alice = await pilot('octo-fixture', SENDER_ID);
      const runner = await online(alice);
      const project = await githubProject(alice);
      await sql(`UPDATE artifact_sources SET source = 'local' WHERE project_id = $1 AND "group" = 'ticket'`, [project.id]);
      await app.get(Reconciliation).run();
      await readiness.settled();
      expect(checkOf(await projectOf(alice, project.id), 'labels')).toBeUndefined();

      await sql(`UPDATE artifact_sources SET source = 'github' WHERE project_id = $1 AND "group" = 'ticket'`, [project.id]);
      runner.send({ type: 'capabilities', engines: [CLAUDE_CONNECTED] });

      await eventually(async () => expect(checkOf(await projectOf(alice, project.id), 'engines')?.state).toBe('ok'));
      const moved = await projectOf(alice, project.id);
      expect(checkOf(moved, 'labels')).toMatchObject({ state: 'missing', facts: { missing: PROCESS_LABELS.length }, fix: 'auto' });
      expect(moved.readiness?.ready).toBe(false);
    });

    it('names the Serveur MCP an Étape uses and the Runner does not declare, and turns ok once it does', async () => {
      const alice = await pilot('octo-fixture', SENDER_ID);
      const runner = await online(alice);
      const project = await githubProject(alice);
      const definition: ProcessDefinition = {
        ...PROCESS_CREWDECK,
        steps: PROCESS_CREWDECK.steps.map((step, index) => (index === 0 ? { ...step, tools: [...step.tools, { kind: 'mcp', name: 'stitch' }] } : step)),
      };
      await sql(
        `INSERT INTO process_versions (id, pilot_id, project_id, number, definition, activated_at, activated_by, template_name) VALUES ($1, $2, $3, 2, $4, now(), 'pilot', NULL)`,
        [newId(), alice.id, project.id, JSON.stringify(definition)],
      );
      await readiness.recompute(alice.id, project.id);
      expect(checkOf(await projectOf(alice, project.id), 'tools')).toMatchObject({ state: 'missing', facts: { mcpMissing: 'stitch', mcpFailed: null }, fix: 'link' });

      runner.send({ type: 'mcp.servers', servers: [{ name: 'stitch', transport: 'stdio', state: 'ready', toolCount: 12 }] });

      await eventually(async () => expect(checkOf(await projectOf(alice, project.id), 'tools')).toMatchObject({ state: 'ok', facts: { mcpMissing: null } }));
    });

    it('without a Runner linked says so, and an Inventaire not approved is its own row', async () => {
      const alice = await pilot('octo-fixture', SENDER_ID);
      await sql('DELETE FROM runners WHERE pilot_id = $1', [alice.id]);
      await deliver('installation', created);
      const repository = (await state(alice)).repositories.find((candidate) => candidate.name === APP_REPO.name);
      expect((await call(alice, '/api/projects', { repositoryIds: [repository?.id], templateId: 'process-crewdeck', seq: (await state(alice)).seq })).status).toBe(201);
      await readiness.settled();
      const [project] = (await state(alice)).projects;

      expect(checkOf(project!, 'runner-linked')).toEqual({ id: 'runner-linked', state: 'missing', facts: {}, fix: 'link' });
      expect(checkOf(project!, 'inventory')).toMatchObject({ state: 'missing', facts: { state: 'pending' }, fix: null });
    });
  });

  describe('a Local Projet', () => {
    it('has no labels nor branches row, and its draft with one Manque keeps it from being ready', async () => {
      const alice = await pilot('alice');
      const runner = await online(alice);
      const { id, status } = await localProject(alice, runner);
      expect(status).toMatchObject({ projectId: id, releaseBranch: 'main', integrationBranch: 'develop' });
      runner.send(folderState(id, {}));

      await eventually(async () => expect(checkOf(await projectOf(alice, id), 'folder')?.state).toBe('ok'));
      const project = await projectOf(alice, id);
      expect(project.readiness?.checks.map((check) => check.id)).not.toContain('labels');
      expect(project.readiness?.checks.map((check) => check.id)).not.toContain('branches');
      expect(checkOf(project, 'process')).toEqual({ id: 'process', state: 'missing', facts: { gaps: 1 }, fix: 'link' });
      expect(project.readiness?.ready).toBe(false);
    });

    it('a folder that is not a git repository: « Corriger » has the Runner prepare it, the row pending then ok', async () => {
      const alice = await pilot('alice');
      const runner = await online(alice);
      const { id } = await localProject(alice, runner);
      runner.send(folderState(id, { isGit: false, hasCommits: false, releaseBranch: false, integrationBranch: false }));
      await eventually(async () => expect(checkOf(await projectOf(alice, id), 'folder')).toMatchObject({ state: 'missing', facts: { reason: 'not-git' }, fix: 'auto' }));

      const res = await fix(alice, id, 'folder');

      expect(res.status).toBe(200);
      expect(checkOf(zProject.parse(await res.json()), 'folder')).toMatchObject({ state: 'pending', facts: { reason: 'preparing' } });
      const prepare = await runner.expect('project.folder.prepare');
      expect(prepare).toMatchObject({ projectId: id, releaseBranch: 'main', integrationBranch: 'develop' });
      runner.send({ type: 'project.folder.prepared', requestId: prepare.requestId, projectId: id, ok: true });
      runner.send(folderState(id, {}));
      await eventually(async () => expect(checkOf(await projectOf(alice, id), 'folder')).toMatchObject({ state: 'ok', fix: null }));
    });

    it('a preparation the Runner never answers, restarted before it could, no longer holds the row pending: « Corriger » again', async () => {
      const alice = await pilot('alice');
      const runner = await online(alice);
      const { id } = await localProject(alice, runner);
      runner.send(folderState(id, { isGit: false, hasCommits: false, releaseBranch: false, integrationBranch: false }));
      await eventually(async () => expect(checkOf(await projectOf(alice, id), 'folder')?.fix).toBe('auto'));
      await fix(alice, id, 'folder');
      await runner.expect('project.folder.prepare');

      const restarted = await online(alice);
      await restarted.expect('project.folder.status');
      restarted.send(folderState(id, { isGit: false, hasCommits: false, releaseBranch: false, integrationBranch: false }));

      await eventually(async () => expect(checkOf(await projectOf(alice, id), 'folder')).toMatchObject({ state: 'missing', facts: { reason: 'not-git' }, fix: 'auto' }));
    });

    it('a preparation pending when the Runner goes offline is no longer awaited', async () => {
      const alice = await pilot('alice');
      const runner = await online(alice);
      const { id } = await localProject(alice, runner);
      runner.send(folderState(id, { isGit: false, hasCommits: false, releaseBranch: false, integrationBranch: false }));
      await eventually(async () => expect(checkOf(await projectOf(alice, id), 'folder')?.fix).toBe('auto'));
      await fix(alice, id, 'folder');
      await runner.expect('project.folder.prepare');

      await runner.close();

      await eventually(async () => expect(checkOf(await projectOf(alice, id), 'folder')).toMatchObject({ state: 'missing', facts: { reason: 'not-git' }, fix: 'auto' }));
    });

    it('without a git identity on the machine, the row says what to set', async () => {
      const alice = await pilot('alice');
      const runner = await online(alice);
      const { id } = await localProject(alice, runner);
      runner.send(folderState(id, { hasCommits: false, releaseBranch: false, integrationBranch: false }));
      await eventually(async () => expect(checkOf(await projectOf(alice, id), 'folder')?.facts['reason']).toBe('no-commit'));

      await fix(alice, id, 'folder');
      const prepare = await runner.expect('project.folder.prepare');
      runner.send({ type: 'project.folder.prepared', requestId: prepare.requestId, projectId: id, ok: false, error: 'git-identity-missing' });
      runner.send(folderState(id, { hasCommits: false, releaseBranch: false, integrationBranch: false }));

      await eventually(async () =>
        expect(checkOf(await projectOf(alice, id), 'folder')).toMatchObject({ state: 'missing', facts: { reason: 'no-commit', error: 'git-identity-missing' }, fix: 'auto' }),
      );
    });

    it('a folder missing links to choosing it again; the Runner offline makes the folder fix 422 runner.offline', async () => {
      const alice = await pilot('alice');
      const runner = await online(alice);
      const { id } = await localProject(alice, runner);
      runner.send(folderState(id, { present: false }));
      await eventually(async () => expect(checkOf(await projectOf(alice, id), 'folder')).toMatchObject({ state: 'missing', facts: { reason: 'missing' }, fix: 'link' }));
      await expectEnvelope(await fix(alice, id, 'folder'), 422, 'project.fix-unavailable');

      runner.send(folderState(id, { isGit: false }));
      await eventually(async () => expect(checkOf(await projectOf(alice, id), 'folder')?.fix).toBe('auto'));
      await runner.close();
      await eventually(async () => expect(app.get(RunnerPresence).isOnline(alice.id)).toBe(false));

      await expectEnvelope(await fix(alice, id, 'folder'), 422, 'runner.offline');
    });
  });

  describe('POST /api/projects/:id/fixes/:checkId', () => {
    it('answers 404 for another Pilote’s Projet and for an id that is not one, 409 on a stale seq, 422 project.fix-unavailable for a check with nothing to fix', async () => {
      const alice = await pilot('octo-fixture', SENDER_ID);
      await online(alice);
      const project = await githubProject(alice);
      const bob = await pilot('bob');

      await expectEnvelope(await fix(bob, project.id, 'branches'), 404, 'project.not-found');
      await expectEnvelope(await fix(alice, 'pas-un-id', 'branches'), 404, 'project.not-found');
      await expectEnvelope(await fix(alice, project.id, 'branches', '0'), 409, 'realtime.stale');
      await expectEnvelope(await fix(alice, project.id, 'engines'), 422, 'project.fix-unavailable');
      await expectEnvelope(await fix(alice, project.id, 'folder'), 422, 'project.fix-unavailable');
      await fix(alice, project.id, 'branches');
      await expectEnvelope(await fix(alice, project.id, 'branches'), 422, 'project.fix-unavailable');
      expect(fakes.github.calls.filter((call) => call.method === 'createBranch')).toHaveLength(1);
    });

    it('answers 401 without a session', async () => {
      await expectEnvelope(await call(undefined, `/api/projects/${newId()}/fixes/labels`, { seq: '1' }), 401, 'auth.required');
    });
  });
});
