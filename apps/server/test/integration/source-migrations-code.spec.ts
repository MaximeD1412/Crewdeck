import { projectFolderAad, projectNameAad, SOURCE_MIGRATION_CODE_TOKEN_PERMISSIONS, type SourceMigration, zProjectList, zSourceMigration, zState } from '@crewdeck/contracts';
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
import { SourceMigrations } from '../../src/process/sources/migrations/source-migrations.service.js';
import { Transactions } from '../../src/realtime/transactions.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
import { sealItem } from '../../src/testing/vault.js';
import { type CodeChangeInput, TicketsWriter } from '../../src/tickets/tickets.writer.js';
import { deliverWebhook, TEST_WEBHOOK_SECRET, webhookFixture } from '../fakes/github.js';
import { connectRunner, type FakeRunnerClient } from '../fakes/runner.js';
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
/** The repository of the installation's fixture, with a branch. */
const FULL = { owner: 'octo-fixture', name: 'fixture-app', id: 71000001 };
/** A repository just created on GitHub, no branch. */
const EMPTY = { owner: 'octo-fixture', name: 'fixture-empty', id: 71000002 };
const bytes = (n: number) => Buffer.alloc(n, 7).toString('base64url');
const SEALED = { key: bytes(60), ciphertext: bytes(32) };
const FINGERPRINT = { key: 'local#3', state: 'open', contentHash: 'a'.repeat(64) };

interface EventRow {
  seq: string;
  type: string;
  payload: Record<string, unknown>;
  tx: string;
}

interface ProjectRow {
  repository_id: string | null;
  github_repo_id: string | null;
  full_name: string | null;
  display_name: string | null;
  folder_state: string | null;
}

describe('the migration of the code and its documents between Local and GitHub (SOURCE-9), against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let fakes: Fakes;
  let migrations: SourceMigrations;
  let alice: { id: string; cookie: string; token: string };
  const sockets: FakeRunnerClient[] = [];
  const vaultKey = randomBytes(32);

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    prisma = app.get(PrismaService);
    fakes = app.get<Fakes>(FAKES);
    migrations = app.get(SourceMigrations);
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
  const lastSeq = async (): Promise<string> => (await sql<{ seq: string }>('SELECT seq::text FROM pilots WHERE id = $1', [alice.id]))[0]?.seq ?? '0';
  const eventsSince = (seq: string) => sql<EventRow>('SELECT seq::text, type, payload, xmin::text AS tx FROM events WHERE pilot_id = $1 AND seq > $2 ORDER BY seq', [alice.id, seq]);
  const projectRow = async (projectId: string) =>
    (await sql<ProjectRow>('SELECT repository_id, github_repo_id::text, full_name, display_name, folder_state FROM projects WHERE id = $1', [projectId]))[0];
  const migrationRow = async (id: string) => (await sql<{ state: string; error_code: string | null }>('SELECT state, error_code FROM source_migrations WHERE id = $1', [id]))[0];
  const sourceOf = async (projectId: string, group: string) => (await sql<{ source: string }>('SELECT source FROM artifact_sources WHERE project_id = $1 AND "group" = $2', [projectId, group]))[0]?.source;
  const codeRows = (projectId: string) =>
    sql<{ number: number; former_number: number | null; former_source: string | null; source: string; title: string | null; sealed: boolean; state: string }>(
      'SELECT number, former_number, former_source, source, title, title_sealed IS NOT NULL AS sealed, state FROM code_changes WHERE project_id = $1 ORDER BY number',
      [projectId],
    );
  /** The repository's id, read in the table: the state's slice lists only the unfollowed ones. */
  const repositoryId = async (fullName: string): Promise<string> => {
    const [repository] = await sql<{ id: string }>('SELECT id FROM repositories WHERE full_name = $1', [fullName]);
    if (!repository) throw new Error(`no repository ${fullName}`);
    return repository.id;
  };

  beforeEach(async () => {
    await empty();
    fakes.github.reset();
    fakes.github.seedRepo({ ...FULL, installationId: INSTALLATION_ID, files: { 'README.md': '# App' } });
    fakes.github.seedRepo({ ...EMPTY, installationId: INSTALLATION_ID, empty: true });
    const id = newId();
    await sql(
      `WITH p AS (INSERT INTO pilots (id, display_name, time_zone, getting_started_step, vault_key_version) VALUES ($1, 'octo-fixture', 'Europe/Paris', 'done', 1) RETURNING id) INSERT INTO pilot_identities (id, pilot_id, provider, subject, login) SELECT gen_random_uuid(), id, 'github', $2::text, 'octo-fixture' FROM p`,
      [id, SENDER_ID],
    );
    const cookie = `${SESSION_COOKIE}=${await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined))}`;
    const { token } = await createLinkedRunner(prisma, id);
    alice = { id, cookie, token };
    expect((await deliverWebhook(url, { event: 'installation', payload: created })).status).toBe(202);
    await app.get(WebhookDispatcher).settled();
  });

  afterEach(async () => {
    await migrations.idle();
    await Promise.all(sockets.splice(0).map((socket) => socket.close()));
  });

  const online = async (): Promise<FakeRunnerClient> => {
    const socket = await connectRunner(url, alice.token);
    sockets.push(socket);
    socket.hello({ migrations: ['ticket', 'code'] });
    await socket.expect('hello.accepted');
    return socket;
  };

  /** A Local Projet with code, created as the page does (PROJET-6), its folder there. */
  const createLocal = async (socket: FakeRunnerClient): Promise<string> => {
    const id = newId();
    const res = await call('POST', '/api/projects/local', {
      id,
      nameSealed: sealItem(vaultKey, 'Recettes secrètes', projectNameAad(id)),
      folderSealed: sealItem(vaultKey, JSON.stringify({ path: '/projets/recettes' }), projectFolderAad(id)),
      vaultKeyVersion: 1,
      hasCode: true,
      releaseBranch: 'main',
      templateId: 'process-crewdeck',
    });
    expect(res.status).toBe(201);
    socket.send({ type: 'projects.folders', present: [id] });
    await vi.waitFor(async () => expect((await projectRow(id))?.folder_state).toBe('present'));
    return id;
  };

  /** A GitHub Projet following fixture-app, every group on GitHub. */
  const followFull = async (): Promise<string> => {
    const { seq } = await state();
    const res = await call('POST', '/api/projects', { repositoryIds: [await repositoryId(`${FULL.owner}/${FULL.name}`)], templateId: 'process-crewdeck', seq: String(seq) });
    expect(res.status).toBe(201);
    return zProjectList.parse(await res.json()).items[0]?.id ?? '';
  };

  const changes = (projectId: string, source: 'local' | 'github', items: { number: number; state: 'open' | 'draft' | 'merged' | 'closed'; headRef: string }[]) => {
    const inputs: CodeChangeInput[] = items.map(({ number, state: changeState, headRef }) => ({
      number,
      title: source === 'github' ? `Changement ${number}` : null,
      titleSealed: source === 'local' ? SEALED : null,
      state: changeState,
      headRef,
      baseRef: 'develop',
      headSha: null,
      mergedAt: changeState === 'merged' ? '2026-11-19T10:00:00.000Z' : null,
      mergeSha: null,
      sourceCreatedAt: '2026-11-18T10:00:00.000Z',
    }));
    return runInPilotScope(alice.id, () => app.get(Transactions).run((tx) => app.get(TicketsWriter).upsertCodeChanges(tx, projectId, source, inputs)));
  };

  const migrate = (projectId: string, group: 'code' | 'ticket', to: 'github' | 'local', target?: unknown) =>
    lastSeq().then((seq) => call('POST', `/api/projects/${projectId}/sources/${group}/migrate`, { to, seq, ...(target === undefined ? {} : { target }) }));

  const expectError = async (res: Response, status: number, code: string) => {
    await expectEnvelope(res, status, code);
  };

  /** The folder picked on the page, held by the Runner as pending once it answers. */
  const pickFolder = async (socket: FakeRunnerClient, projectId: string, group: 'code' | 'ticket') => {
    const picking = call('POST', `/api/projects/${projectId}/sources/${group}/folder`, {
      folderSealed: sealItem(vaultKey, JSON.stringify({ path: '/projets/nouveau' }), projectFolderAad(projectId)),
      vaultKeyVersion: 1,
    });
    await expect(socket.expect('project.folder.pick')).resolves.toMatchObject({ projectId, group });
    socket.send({ type: 'projects.folders', present: [], pending: [projectId] });
    expect((await picking).status).toBe(204);
  };

  const finished = async (socket: FakeRunnerClient, migration: SourceMigration) => {
    socket.send({ type: 'migration.finished', migrationId: migration.id });
    await vi.waitFor(async () => expect((await migrationRow(migration.id))?.state).toBe('done'));
  };

  it('Local → GitHub: the code copied into the empty repository picked, a token of that repository only, the Projet following it at the switch, the open changes renumbered and titled from their PRs', async () => {
    const socket = await online();
    const projectId = await createLocal(socket);
    await changes(projectId, 'local', [
      { number: 2, state: 'merged', headRef: 'feat/2-ancien' },
      { number: 3, state: 'open', headRef: 'feat/3-le-panier' },
      { number: 4, state: 'draft', headRef: 'feat/4-le-paiement' },
    ]);
    const target = await repositoryId(`${EMPTY.owner}/${EMPTY.name}`);

    const res = await migrate(projectId, 'code', 'github', { repositoryId: target });
    expect(res.status).toBe(201);
    const migration = zSourceMigration.parse(await res.json());
    await expect(socket.expect('migration.copy')).resolves.toMatchObject({
      migrationId: migration.id,
      group: 'code',
      from: 'local',
      to: 'github',
      repository: { owner: EMPTY.owner, name: EMPTY.name },
      branches: { release: 'main', integration: 'develop' },
    });
    await vi.waitFor(async () => expect((await migrationRow(migration.id))?.state).toBe('copying'));
    // The repository is the migration's until the switch, not yet the Projet's.
    expect(await projectRow(projectId)).toMatchObject({ repository_id: null, github_repo_id: null, folder_state: 'present' });

    // The copy's token: contents, pull_requests and workflows on the repository picked only.
    fakes.github.calls.length = 0;
    const token = await fetch(`${url}/api/runner/source-migrations/${migration.id}/github-token`, { method: 'POST', headers: { authorization: `Bearer ${alice.token}` } });
    expect(token.status).toBe(200);
    expect(fakes.github.calls).toEqual([{ method: 'installationToken', args: [INSTALLATION_ID, { repositoryIds: [EMPTY.id], permissions: { contents: 'write', pull_requests: 'write', workflows: 'write' } }] }]);
    expect(SOURCE_MIGRATION_CODE_TOKEN_PERMISSIONS).toEqual({ contents: 'write', pull_requests: 'write', workflows: 'write' });

    // The Runner pushes every branch, then opens a PR per open change.
    for (const branch of ['main', 'develop', 'feat/3-le-panier', 'feat/4-le-paiement']) await fakes.github.pushCommit(EMPTY, branch, { 'README.md': `# ${branch}` });
    const panier = await fakes.github.createPullRequest(EMPTY, { head: 'feat/3-le-panier', base: 'develop', title: 'Le panier', draft: false });
    const paiement = await fakes.github.createPullRequest(EMPTY, { head: 'feat/4-le-paiement', base: 'develop', title: 'Le paiement', draft: true });

    const before = await lastSeq();
    socket.send({
      type: 'migration.switch',
      migrationId: migration.id,
      fingerprints: [FINGERPRINT],
      renumbering: [
        { from: 3, to: panier.number },
        { from: 4, to: paiement.number },
      ],
    });
    await socket.expect('migration.finish');

    expect(await projectRow(projectId)).toMatchObject({ repository_id: target, github_repo_id: String(EMPTY.id), full_name: `${EMPTY.owner}/${EMPTY.name}`, folder_state: 'present' });
    expect(await sourceOf(projectId, 'code')).toBe('github');
    const events = await eventsSince(before);
    const switchTx = events.find((event) => event.type === 'source-migration.upserted' && event.payload.state === 'switched')?.tx;
    expect(switchTx).toBeDefined();
    const inSwitch = events.filter((event) => event.tx === switchTx);
    expect(inSwitch.find((event) => event.type === 'repository.upserted')?.payload).toMatchObject({ id: target, followed: true });
    expect(inSwitch.find((event) => event.type === 'project.upserted')?.payload).toMatchObject({ id: projectId });
    expect(inSwitch.filter((event) => event.type === 'code-change.upserted').map((event) => [event.payload.number, event.payload.formerNumber, event.payload.formerSource, event.payload.source])).toEqual([
      [panier.number, 3, 'local', 'github'],
      [paiement.number, 4, 'local', 'github'],
    ]);
    expect(inSwitch.filter((event) => event.type === 'code-change.removed')).toHaveLength(1);

    // The reconciliation once committed fills the titles from the PRs; the merged change, not copied, is gone.
    await vi.waitFor(async () =>
      expect((await codeRows(projectId)).map(({ number, former_number, source, title, sealed }) => ({ number, former_number, source, title, sealed }))).toEqual([
        { number: panier.number, former_number: 3, source: 'github', title: 'Le panier', sealed: false },
        { number: paiement.number, former_number: 4, source: 'github', title: 'Le paiement', sealed: false },
      ]),
    );

    await finished(socket, migration);
    // The Tickets still Local: the repository stays followed, for the code.
    expect(await projectRow(projectId)).toMatchObject({ repository_id: target });
  });

  it('refuses a repository with a branch (source.repository-not-empty), one another Projet follows (source.repository-followed), none picked (source.target-missing)', async () => {
    const socket = await online();
    const projectId = await createLocal(socket);
    const followed = await followFull();
    const full = await repositoryId(`${FULL.owner}/${FULL.name}`);

    fakes.github.calls.length = 0;
    await expectError(await migrate(projectId, 'code', 'github', { repositoryId: full }), 422, 'source.repository-followed');
    expect(fakes.github.calls).toEqual([]);
    await expectError(await migrate(projectId, 'ticket', 'github', { repositoryId: full }), 422, 'source.repository-followed');

    // Unfollowed, it still has a branch.
    await sql('DELETE FROM projects WHERE id = $1', [followed]);
    await expectError(await migrate(projectId, 'code', 'github', { repositoryId: full }), 422, 'source.repository-not-empty');

    await expectError(await migrate(projectId, 'code', 'github'), 422, 'source.target-missing');
    await expectError(await migrate(projectId, 'code', 'github', { repositoryId: newId() }), 422, 'source.target-missing');
    await expectError(await migrate(projectId, 'code', 'github', { folder: true }), 422, 'source.target-missing');
    expect(await sql('SELECT 1 FROM source_migrations WHERE project_id = $1', [projectId])).toEqual([]);

    // The empty one, already the target of a running migration of another Projet.
    const other = await createLocal(socket);
    const target = await repositoryId(`${EMPTY.owner}/${EMPTY.name}`);
    expect((await migrate(other, 'code', 'github', { repositoryId: target })).status).toBe(201);
    await expectError(await migrate(projectId, 'code', 'github', { repositoryId: target }), 422, 'source.repository-followed');
  });

  it('GitHub → Local: the folder picked held by the Runner, the clone sent, the Projet’s folder at the switch, the repository still followed while the Tickets are on GitHub', async () => {
    const socket = await online();
    const projectId = await followFull();
    await changes(projectId, 'github', [
      { number: 40, state: 'open', headRef: 'feat/40-le-panier' },
      { number: 41, state: 'closed', headRef: 'feat/41-abandon' },
    ]);

    // Without the folder picked first, nothing starts.
    await expectError(await migrate(projectId, 'code', 'local', { folder: true }), 422, 'source.folder-not-picked');
    await expectError(await migrate(projectId, 'code', 'local'), 422, 'source.target-missing');

    await pickFolder(socket, projectId, 'code');
    const res = await migrate(projectId, 'code', 'local', { folder: true });
    expect(res.status).toBe(201);
    const migration = zSourceMigration.parse(await res.json());
    await expect(socket.expect('migration.copy')).resolves.toMatchObject({ group: 'code', from: 'github', to: 'local', repository: { owner: FULL.owner, name: FULL.name }, branches: { release: 'main', integration: 'develop' } });
    await vi.waitFor(async () => expect((await migrationRow(migration.id))?.state).toBe('copying'));
    expect((await projectRow(projectId))?.folder_state).toBeNull();

    const before = await lastSeq();
    socket.send({ type: 'migration.switch', migrationId: migration.id, fingerprints: [{ key: 'github#40', state: 'open', contentHash: 'b'.repeat(64) }], renumbering: [{ from: 40, to: 1 }] });
    await socket.expect('migration.finish');
    expect(await projectRow(projectId)).toMatchObject({ folder_state: 'present', github_repo_id: String(FULL.id) });
    const switchTx = (await eventsSince(before)).find((event) => event.type === 'source-migration.upserted' && event.payload.state === 'switched')?.tx;
    expect((await eventsSince(before)).find((event) => event.type === 'project.upserted' && event.tx === switchTx)?.payload).toMatchObject({ folder: 'present' });
    expect(await codeRows(projectId)).toEqual([{ number: 1, former_number: 40, former_source: 'github', source: 'local', title: null, sealed: false, state: 'open' }]);

    // The Runner's report, its folder now the Projet's, keeps it present.
    socket.send({ type: 'projects.folders', present: [projectId] });
    await finished(socket, migration);
    expect(await projectRow(projectId)).toMatchObject({ repository_id: expect.any(String), github_repo_id: String(FULL.id), folder_state: 'present' });
    expect(await sourceOf(projectId, 'ticket')).toBe('github');
  });

  it('leaving GitHub with the Tickets already Local unfollows the repository at done, the Projet keeping its name; a webhook of it then writes nothing', async () => {
    const socket = await online();
    const projectId = await followFull();
    await sql(`UPDATE artifact_sources SET source = 'local' WHERE project_id = $1 AND "group" = 'ticket'`, [projectId]);
    const full = await repositoryId(`${FULL.owner}/${FULL.name}`);

    await pickFolder(socket, projectId, 'code');
    const migration = zSourceMigration.parse(await (await migrate(projectId, 'code', 'local', { folder: true })).json());
    await socket.expect('migration.copy');
    await vi.waitFor(async () => expect((await migrationRow(migration.id))?.state).toBe('copying'));
    socket.send({ type: 'migration.switch', migrationId: migration.id, fingerprints: [], renumbering: [] });
    await socket.expect('migration.finish');
    // Switched, not done: still followed, the finish may still read it.
    expect((await projectRow(projectId))?.repository_id).toBe(full);

    const before = await lastSeq();
    await finished(socket, migration);
    expect(await projectRow(projectId)).toMatchObject({ repository_id: null, github_repo_id: null, full_name: null, display_name: FULL.name, folder_state: 'present' });
    const events = await eventsSince(before);
    expect(events.find((event) => event.type === 'repository.upserted')?.payload).toMatchObject({ id: full, followed: false });
    expect(events.find((event) => event.type === 'project.upserted')?.payload).toMatchObject({ id: projectId, repositoryId: null });
    expect((await state()).repositories.map((item) => item.id)).toContain(full);

    // A pull_request of the old repository finds no Projet: no row written.
    const pullRequest = webhookFixture<Record<string, unknown>>('pull_request');
    expect((await deliverWebhook(url, { event: 'pull_request', payload: pullRequest })).status).toBe(202);
    await app.get(WebhookDispatcher).settled();
    expect(await codeRows(projectId)).toEqual([]);
  });

  it('a branch diverged at the finish raises « Migration de Source inachevée » at once, the new Source kept: no retry would bring the two places back together', async () => {
    const socket = await online();
    const projectId = await followFull();
    await pickFolder(socket, projectId, 'code');
    const res = await migrate(projectId, 'code', 'local', { folder: true });
    expect(res.status).toBe(201);
    const migration = zSourceMigration.parse(await res.json());
    await socket.expect('migration.copy');
    await vi.waitFor(async () => expect((await migrationRow(migration.id))?.state).toBe('copying'));
    socket.send({ type: 'migration.switch', migrationId: migration.id, fingerprints: [{ key: 'branch:develop', state: 'c'.repeat(40), contentHash: 'c'.repeat(64) }], renumbering: [] });
    await socket.expect('migration.finish');

    socket.send({ type: 'migration.failed', migrationId: migration.id, stage: 'finish', code: 'branch.diverged' });
    await vi.waitFor(async () =>
      expect(await sql<{ kind: string }>(`SELECT kind FROM decisions WHERE pilot_id = $1 AND state = 'open'`, [alice.id])).toEqual([{ kind: 'source-migration.unfinished' }]),
    );
    expect(await migrationRow(migration.id)).toEqual({ state: 'switched', error_code: 'branch.diverged' });
    expect(await sourceOf(projectId, 'code')).toBe('local');
  });

  it('a copy to Local that fails lets the Runner drop the folder it held, the Projet without a folder', async () => {
    const socket = await online();
    const projectId = await followFull();
    await pickFolder(socket, projectId, 'code');
    const res = await migrate(projectId, 'code', 'local', { folder: true });
    expect(res.status).toBe(201);
    const migration = zSourceMigration.parse(await res.json());
    await socket.expect('migration.copy');
    socket.send({ type: 'migration.failed', migrationId: migration.id, stage: 'copy', code: 'source.folder-not-empty' });
    await expect(socket.expect('project.folder.drop')).resolves.toMatchObject({ projectId });
    await vi.waitFor(async () => expect((await migrationRow(migration.id))?.state).toBe('failed'));
    expect((await projectRow(projectId))?.folder_state).toBeNull();
  });
});
