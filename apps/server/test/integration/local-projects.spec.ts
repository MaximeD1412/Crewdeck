import { type Decision, findGaps, folderCheckAad, PROCESS_CREWDECK, folderCheckedAad, projectFolderAad, projectNameAad, zDecision, zProject, zState } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PinoLogger } from 'nestjs-pino';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
import { sealItem } from '../../src/testing/vault.js';
import { connectRunner, type FakeRunnerClient } from '../fakes/runner.js';
import { connect, type WsClient } from '../fakes/ws-client.js';
import { expectEnvelope, expectFields, startApp } from '../route-baseline.js';
import { readinessSettled, withoutReadiness } from '../readiness.js';

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

/** Every row of every table, as text: what a reader of the database would see. */
const database = async (): Promise<string> => {
  const tables = await sql<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  const dumps = await Promise.all(tables.map(({ tablename }) => sql<{ row: string }>(`SELECT row_to_json(t)::text AS row FROM "${tablename}" t`)));
  return dumps.flat().map(({ row }) => row).join('\n');
};

/** The SQL statements a client of `pg` (Prisma's adapter among them) sends from now on. */
const spyQueries = () => {
  const spy = vi.spyOn(pg.Client.prototype, 'query');
  const all = (): string[] => spy.mock.calls.map(([query]) => (typeof query === 'string' ? query : ((query as { text?: string }).text ?? '')));
  return {
    writes: () => all().filter((text) => /^\s*(insert|update|delete|merge|upsert)\b/i.test(text)),
    stop: () => spy.mockRestore(),
  };
};

const PATH = '/home/pilote/projets/recettes-secretes';
const NAME = 'Recettes secrètes';

interface Pilot {
  id: string;
  cookie: string;
  token: string;
}

describe('the Local Projets against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  const lines: string[] = [];
  const closers: (WsClient | FakeRunnerClient)[] = [];
  const vaultKey = randomBytes(32);

  beforeAll(async () => {
    ({ app, url } = await startApp(env, { logs: { write: (line: string) => lines.push(line) } }));
    prisma = app.get(PrismaService);
    // What a relayed frame logs is debug: the test reads it.
    PinoLogger.root.level = 'debug';
  });

  afterAll(async () => {
    await reset();
    await app.close();
  });

  beforeEach(async () => {
    lines.length = 0;
    await reset();
  });

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((closer) => closer.close()));
  });

  const pilot = async (login: string): Promise<Pilot> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, display_name, time_zone, getting_started_step, vault_key_version) VALUES ($1, $2, 'Europe/Paris', 'projects', 1)`, [id, login]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    const runner = await createLinkedRunner(prisma, id);
    return { id, cookie: `${SESSION_COOKIE}=${token}`, token: runner.token };
  };

  const online = async ({ token }: Pilot, machine = 'atelier'): Promise<FakeRunnerClient> => {
    const socket = await connectRunner(url, token);
    closers.push(socket);
    socket.hello({ machine });
    await socket.expect('hello.accepted');
    return socket;
  };

  const tab = async ({ cookie }: Pilot): Promise<WsClient> => {
    const client = await connect(url, { cookie, origin: ORIGIN });
    closers.push(client);
    client.send({ type: 'ping' });
    await client.next('pong');
    return client;
  };

  const call = (who: Pilot | undefined, path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(who ? { cookie: who.cookie } : {}), origin: ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const state = async (who: Pilot) => zState.parse(await (await call(who, '/api/state')).json());

  const localProject = (id = newId(), fields: Record<string, unknown> = {}) => ({
    id,
    nameSealed: sealItem(vaultKey, NAME, projectNameAad(id)),
    folderSealed: sealItem(vaultKey, JSON.stringify({ path: PATH }), projectFolderAad(id)),
    vaultKeyVersion: 1,
    hasCode: true,
    releaseBranch: 'trunk',
    templateId: 'process-crewdeck',
    ...fields,
  });

  /** The Pilote's events but their Runner's own (its hello, its heartbeats). */
  // Once the readiness is written, without its own events.
  const eventsOf = async (who: Pilot) => {
    await readinessSettled(app);
    return withoutReadiness(await sql<{ type: string; payload: Record<string, unknown> }>(`SELECT type, payload FROM events WHERE pilot_id = $1 AND type NOT LIKE 'runner.%' ORDER BY seq`, [who.id]));
  };

  /** Waits until `check` passes, the server's handling of a Runner's message being asynchronous. */
  const eventually = async (check: () => Promise<void>): Promise<void> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await check();
      } catch (error) {
        if (attempt === 50) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  };

  const projectOf = async (who: Pilot, id: string) => zProject.parse(await (await call(who, `/api/projects/${id}`)).json());

  const openDecisions = async (who: Pilot): Promise<Decision[]> => (await state(who)).decisions.map((decision) => zDecision.parse(decision));

  describe('POST /api/projects/local', () => {
    it('creates a Local Projet: no repository, its name sealed, its folder pending then present once the Runner stored it, its Sources Local, its Process a draft of « Process Crewdeck »', async () => {
      const alice = await pilot('alice');
      const runner = await online(alice);
      const body = localProject();

      const res = await call(alice, '/api/projects/local', body);

      expect(res.status).toBe(201);
      const created = zProject.parse(await res.json());
      expect(created).toMatchObject({
        id: body.id,
        repositoryId: null,
        owner: null,
        name: null,
        fullName: null,
        displayName: null,
        nameSealed: body.nameSealed,
        folder: 'pending',
        integrationBranch: 'develop',
        releaseBranch: 'trunk',
        hasCode: true,
        inventoryState: 'pending',
      });
      expect(await runner.expect('project.folder.attach')).toMatchObject({ projectId: body.id, sealed: body.folderSealed });

      const sources = await sql<{ group: string; source: string }>('SELECT "group", source FROM artifact_sources WHERE project_id = $1 ', [body.id]);
      expect(sources.sort((a, b) => a.group.localeCompare(b.group))).toEqual([
        { group: 'code', source: 'local' },
        { group: 'ticket', source: 'local' },
      ]);
      expect(await sql('SELECT id FROM process_versions WHERE project_id = $1', [body.id])).toEqual([]);
      expect(await sql('SELECT revision FROM process_drafts WHERE project_id = $1', [body.id])).toEqual([{ revision: 1 }]);
      const after = await state(alice);
      const process = after.processes.find((candidate) => candidate.id === body.id);
      expect(process).toMatchObject({ active: null, draft: expect.objectContaining({ revision: 1 }) });
      // Its Manque: « Checks » needs a Commande, no CI without GitHub (PROCESS-3's rule).
      const gaps = findGaps(process?.draft?.definition ?? PROCESS_CREWDECK, { ticket: 'local', code: 'local' });
      expect(gaps.map((gap) => gap.label)).toEqual([expect.stringMatching(/Checks.*Commande/)]);

      runner.send({ type: 'projects.folders', present: [body.id] });
      await eventually(async () => expect((await projectOf(alice, body.id)).folder).toBe('present'));
      const types = (await eventsOf(alice)).map((event) => event.type);
      expect(types).toEqual(['project.upserted', 'process.upserted', 'project.upserted']);
      expect(await openDecisions(alice)).toEqual([]);
    });

    it('starts a Projet without code with no inventory, and on main when its folder has no branch', async () => {
      const alice = await pilot('alice');
      await online(alice);
      const res = await call(alice, '/api/projects/local', localProject(newId(), { hasCode: false, releaseBranch: null }));
      expect(res.status).toBe(201);
      expect(zProject.parse(await res.json())).toMatchObject({ hasCode: false, inventoryState: 'not-needed', releaseBranch: 'main' });
    });

    it('answers 422 runner.offline while the Runner is away, and writes nothing', async () => {
      const alice = await pilot('alice');
      await expectEnvelope(await call(alice, '/api/projects/local', localProject()), 422, 'runner.offline');
      expect(await sql('SELECT id FROM projects')).toEqual([]);
    });

    it('answers 422 project.id-taken for an id already used, even by another Pilote', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      await online(alice);
      await online(bob);
      const body = localProject();
      expect((await call(alice, '/api/projects/local', body)).status).toBe(201);

      await expectEnvelope(await call(alice, '/api/projects/local', body), 422, 'project.id-taken');
      await expectEnvelope(await call(bob, '/api/projects/local', localProject(body.id)), 422, 'project.id-taken');
      expect((await state(bob)).projects).toEqual([]);
    });

    it('answers 400 with fields for a body the contract refuses', async () => {
      const alice = await pilot('alice');
      await online(alice);
      await expectFields(await call(alice, '/api/projects/local', { ...localProject(), id: 'nope', templateId: 'process-maison' }), ['id', 'templateId']);
      await expectFields(await call(alice, '/api/projects/local', { ...localProject(), nameSealed: { key: 'x', ciphertext: 'y' } }), ['nameSealed.key', 'nameSealed.ciphertext']);
    });

    it('answers 409 vault.version-changed to a name and a folder sealed before a rotation, and writes nothing; sealed again under the new key, it is created', async () => {
      const alice = await pilot('alice');
      const runner = await online(alice);
      const body = localProject();
      // Another holder rotated while the page's POST was on its way.
      await sql('UPDATE pilots SET vault_key_version = 2 WHERE id = $1', [alice.id]);

      await expectEnvelope(await call(alice, '/api/projects/local', body), 409, 'vault.version-changed');
      expect(await sql('SELECT id FROM projects')).toEqual([]);
      expect(await eventsOf(alice)).toEqual([]);

      expect((await call(alice, '/api/projects/local', { ...body, vaultKeyVersion: 2 })).status).toBe(201);
      expect(await runner.expect('project.folder.attach')).toMatchObject({ projectId: body.id });
    });

    it('answers 401 without a session', async () => {
      await expectEnvelope(await call(undefined, '/api/projects/local', localProject()), 401, 'auth.required');
    });
  });

  describe('the folder of a Local Projet', () => {
    const created = async (who: Pilot, runner: FakeRunnerClient) => {
      const body = localProject();
      expect((await call(who, '/api/projects/local', body)).status).toBe(201);
      await runner.expect('project.folder.attach');
      runner.send({ type: 'projects.folders', present: [body.id] });
      await eventually(async () => expect((await projectOf(who, body.id)).folder).toBe('present'));
      return body.id;
    };

    it('turns missing with its open Décision when the Runner no longer has it, and present again once its folder is chosen again', async () => {
      const alice = await pilot('alice');
      const runner = await online(alice);
      const id = await created(alice, runner);

      runner.send({ type: 'projects.folders', present: [] });
      await eventually(async () => expect((await projectOf(alice, id)).folder).toBe('missing'));
      const [decision] = await openDecisions(alice);
      expect(decision).toMatchObject({
        kind: 'project.folder-missing',
        subjectType: 'project',
        subjectId: id,
        projectId: id,
        projectName: null,
        label: 'Choisis à nouveau son dossier',
        metaParts: ['atelier'],
        tone: 'halt',
        link: `/projets/ajouter?projet=${id}`,
      });
      // The same report again: nothing new.
      const before = (await eventsOf(alice)).length;
      runner.send({ type: 'projects.folders', present: [] });
      runner.heartbeat();
      await runner.expect('heartbeat.ack');
      expect((await eventsOf(alice)).length).toBe(before);

      const seq = (await state(alice)).seq;
      const folderSealed = sealItem(vaultKey, JSON.stringify({ path: PATH }), projectFolderAad(id));
      const res = await call(alice, `/api/projects/${id}/folder`, { folderSealed, vaultKeyVersion: 1, seq: String(seq) });
      expect(res.status).toBe(200);
      expect(zProject.parse(await res.json())).toMatchObject({ id, folder: 'pending' });
      expect(await runner.expect('project.folder.attach')).toMatchObject({ projectId: id, sealed: folderSealed });

      runner.send({ type: 'projects.folders', present: [id] });
      await eventually(async () => expect((await projectOf(alice, id)).folder).toBe('present'));
      expect(await openDecisions(alice)).toEqual([]);
      // Pending, then present with its Décision resolved.
      expect((await eventsOf(alice)).map((event) => event.type).slice(-3)).toEqual(['project.upserted', 'project.upserted', 'decision.removed']);
    });

    it('turns missing when another Runner is linked, which has none of the folders', async () => {
      const alice = await pilot('alice');
      const runner = await online(alice);
      const id = await created(alice, runner);
      await runner.close();

      await sql('UPDATE runners SET revoked_at = now() WHERE pilot_id = $1', [alice.id]);
      const replacement = await createLinkedRunner(prisma, alice.id, { machine: 'portable' });
      const other = await online({ ...alice, token: replacement.token }, 'portable');
      other.send({ type: 'projects.folders', present: [] });

      await eventually(async () => expect((await projectOf(alice, id)).folder).toBe('missing'));
      expect((await openDecisions(alice)).map((decision) => decision.metaParts)).toEqual([['portable']]);
    });

    it('leaves a GitHub Projet alone', async () => {
      const alice = await pilot('alice');
      const runner = await online(alice);
      const githubId = newId();
      await sql(
        `INSERT INTO projects (id, pilot_id, repository_id, github_repo_id, owner, name, full_name, display_name, release_branch, integration_branch, has_code, inventory_state)
         VALUES ($1, $2, $3, 42, 'acme', 'shop', 'acme/shop', 'shop', 'main', 'develop', true, 'not-needed')`,
        [githubId, alice.id, newId()],
      );
      runner.send({ type: 'projects.folders', present: [] });
      runner.heartbeat();
      await runner.expect('heartbeat.ack');
      expect((await projectOf(alice, githubId)).folder).toBeNull();
      expect(await eventsOf(alice)).toEqual([]);
    });
  });

  describe('POST /api/projects/:id/folder', () => {
    const attach = (who: Pilot, id: string, seq: string, vaultKeyVersion = 1) =>
      call(who, `/api/projects/${id}/folder`, { folderSealed: sealItem(vaultKey, JSON.stringify({ path: PATH }), projectFolderAad(id)), vaultKeyVersion, seq });

    it('answers 404 for another Pilote’s Projet, 409 for a stale seq, 422 project.not-local for a GitHub Projet, 422 runner.offline while the Runner is away', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const runner = await online(alice);
      const body = localProject();
      expect((await call(alice, '/api/projects/local', body)).status).toBe(201);
      await runner.expect('project.folder.attach');

      const seq = String((await state(alice)).seq);
      await expectEnvelope(await attach(bob, body.id, String((await state(bob)).seq)), 404, 'project.not-found');
      await expectEnvelope(await attach(alice, 'nope', '0'), 404, 'project.not-found');
      await expectEnvelope(await attach(alice, body.id, '0'), 409, 'realtime.stale');

      const githubId = newId();
      await sql(
        `INSERT INTO projects (id, pilot_id, repository_id, github_repo_id, owner, name, full_name, display_name, release_branch, integration_branch, has_code, inventory_state)
         VALUES ($1, $2, $3, 43, 'acme', 'shop', 'acme/shop', 'shop', 'main', 'develop', true, 'not-needed')`,
        [githubId, alice.id, newId()],
      );
      await expectEnvelope(await attach(alice, githubId, seq), 422, 'project.not-local');

      await runner.close();
      await eventually(async () => expectEnvelope(await attach(alice, body.id, seq), 422, 'runner.offline').then(() => undefined));
    });

    it('answers 409 vault.version-changed to a folder sealed before a rotation, and sends nothing to the Runner', async () => {
      const alice = await pilot('alice');
      const runner = await online(alice);
      const body = localProject();
      expect((await call(alice, '/api/projects/local', body)).status).toBe(201);
      await runner.expect('project.folder.attach');
      runner.send({ type: 'projects.folders', present: [] });
      await eventually(async () => expect((await projectOf(alice, body.id)).folder).toBe('missing'));
      await sql('UPDATE pilots SET vault_key_version = 2 WHERE id = $1', [alice.id]);
      const before = await eventsOf(alice);

      await expectEnvelope(await attach(alice, body.id, String((await state(alice)).seq)), 409, 'vault.version-changed');
      expect((await projectOf(alice, body.id)).folder).toBe('missing');
      expect(await eventsOf(alice)).toEqual(before);

      expect((await attach(alice, body.id, String((await state(alice)).seq), 2)).status).toBe(200);
      // The first message the Runner gets since: the attach sealed under the new key.
      expect(await runner.expect('project.folder.attach')).toMatchObject({ projectId: body.id });
    });

    it('answers 400 with fields, and 401 without a session', async () => {
      const alice = await pilot('alice');
      await expectFields(await call(alice, `/api/projects/${newId()}/folder`, { seq: 'x' }), ['folderSealed', 'vaultKeyVersion', 'seq']);
      await expectEnvelope(await call(undefined, `/api/projects/${newId()}/folder`, { folderSealed: sealItem(vaultKey, '{}', 'x'), seq: '0' }), 401, 'auth.required');
    });
  });

  describe('the relay of a folder’s check', () => {
    it('relays a check to the Runner and its answer to the tab that asked only, writing nothing, never the path nor the name in clear in the database or the logs', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const runner = await online(alice);
      const asker = await tab(alice);
      const other = await tab(alice);
      const stranger = await tab(bob);
      const requestId = newId();
      const sealed = sealItem(vaultKey, JSON.stringify({ path: PATH }), folderCheckAad(requestId));
      const answer = sealItem(vaultKey, JSON.stringify({ state: 'ready', hasCode: true, branch: 'main', name: 'recettes-secretes' }), folderCheckedAad(requestId));
      const queries = spyQueries();

      try {
        asker.send({ type: 'folder.check', requestId, sealed });
        const check = await runner.expect('folder.check');
        expect(check).toMatchObject({ requestId, sealed, tabId: expect.any(String) });

        runner.send({ type: 'folder.checked', requestId, tabId: check.tabId, sealed: answer });
        expect(await asker.next('folder.checked')).toEqual({ type: 'folder.checked', requestId, sealed: answer });

        for (const client of [other, stranger]) {
          client.send({ type: 'ping' });
          await client.next('pong');
          expect(client.collect().map((message) => message.type)).toEqual(['pong', 'pong']);
        }
        expect(queries.writes()).toEqual([]);
      } finally {
        queries.stop();
      }

      // And a Projet created from it: its name and its path sealed all the way.
      const body = localProject();
      expect((await call(alice, '/api/projects/local', body)).status).toBe(201);
      await runner.expect('project.folder.attach');

      const output = lines.join('');
      const stored = await database();
      for (const secret of [PATH, NAME, 'recettes-secretes']) {
        expect(output).not.toContain(secret);
        expect(stored).not.toContain(secret);
      }
      for (const item of [sealed, answer, body.folderSealed, body.nameSealed]) expect(output).not.toContain(item.ciphertext);
      for (const item of [sealed, answer, body.folderSealed]) expect(stored).not.toContain(item.ciphertext);
      const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(logged).toContainEqual(expect.objectContaining({ msg: 'folder relay', type: 'folder.check', requestId }));
      expect(logged).toContainEqual(expect.objectContaining({ msg: 'folder relay', type: 'folder.checked', requestId }));
    });

    it('answers folder.error runner.offline while the Runner is away', async () => {
      const alice = await pilot('alice');
      const client = await tab(alice);
      const requestId = newId();
      client.send({ type: 'folder.check', requestId, sealed: sealItem(vaultKey, JSON.stringify({ path: PATH }), folderCheckAad(requestId)) });
      expect(await client.next('folder.error')).toEqual({ type: 'folder.error', requestId, code: 'runner.offline' });
    });

    it('sends nothing to a tab of another Pilote that the Runner names', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const aliceRunner = await online(alice);
      const bobRunner = await online(bob);
      const bobTab = await tab(bob);
      const requestId = newId();
      bobTab.send({ type: 'folder.check', requestId, sealed: sealItem(vaultKey, JSON.stringify({ path: PATH }), folderCheckAad(requestId)) });
      const check = await bobRunner.expect('folder.check');

      aliceRunner.send({ type: 'folder.checked', requestId, tabId: check.tabId, sealed: sealItem(vaultKey, '{}', folderCheckedAad(requestId)) });
      aliceRunner.heartbeat();
      await aliceRunner.expect('heartbeat.ack');
      bobTab.send({ type: 'ping' });
      await bobTab.next('pong');
      expect(bobTab.collect().map((message) => message.type)).toEqual(['pong', 'pong']);
    });
  });
});
