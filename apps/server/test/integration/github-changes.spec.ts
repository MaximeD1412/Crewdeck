import { type MirrorProject, type ServerToRunner, zProjectList, zState } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { MirrorRelay } from '../../src/github/changes/mirror-relay.js';
import { GITHUB_CHANGES_KEPT_MS, GitHubChangesRetention } from '../../src/github/changes/retention.job.js';
import { WebhookDispatcher } from '../../src/github/webhooks/dispatcher.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
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
const APP_REPO = { owner: 'octo-fixture', name: 'fixture-app', id: 71000001 };
const OTHER_REPO = { owner: 'octo-fixture', name: 'other-app', id: 71000002 };
const FULL_NAME = `${APP_REPO.owner}/${APP_REPO.name}`;
const HEAD = '6dcb09b5b57875f334f61aebed695e2e4193db5e';

/** The columns of a `github_changes` row, and the keys of a `github.changed`'s change: the envelope's, no other. */
const ROW_COLUMNS = ['action', 'at', 'kind', 'number', 'pilot_id', 'project_id', 'ref', 'repository', 'seq', 'sha'];
const CHANGE_KEYS = ['action', 'at', 'kind', 'number', 'projectId', 'ref', 'repository', 'seq', 'sha'];

interface ChangeRow {
  seq: string;
  project_id: string;
  repository: string;
  kind: string;
  number: number | null;
  sha: string | null;
  ref: string | null;
  action: string | null;
  at: Date;
}

const MIRROR_TYPES = new Set(['github.changed', 'mirror.resync', 'mirror.live', 'mirror.projects']);
const mirrorOf = (runner: FakeRunnerClient): ServerToRunner[] => runner.received().filter((message) => MIRROR_TYPES.has(message.type));

/** Each Miroir message as a short line: `projects`, `resync`, `live 5`, `change 4`. */
const lines = (messages: readonly ServerToRunner[]): string[] =>
  messages.map((message) => {
    if (message.type === 'github.changed') return `change ${message.change.seq}`;
    if (message.type === 'mirror.live') return `live ${message.seq}`;
    return message.type.replace('mirror.', '');
  });

describe('the envelopes of GitHub’s changes for the Runner’s Miroir, against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let fakes: Fakes;
  let dispatcher: WebhookDispatcher;
  let relay: MirrorRelay;
  const runners: FakeRunnerClient[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    prisma = app.get(PrismaService);
    fakes = app.get<Fakes>(FAKES);
    dispatcher = app.get(WebhookDispatcher);
    relay = app.get(MirrorRelay);
  });

  const empty = () => sql('TRUNCATE pilots, github_installations, github_deliveries CASCADE');

  afterAll(async () => {
    await empty();
    await app.close();
  });

  let pilotId: string;
  let cookie: string;
  let projectId: string;

  const call = (path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const state = async () => zState.parse(await (await call('/api/state')).json());

  /** Delivers `payload` (a fixture's, by default) as GitHub does, and waits for its handlers. */
  const deliver = async (event: string, payload: unknown = webhookFixture(event)): Promise<void> => {
    expect((await deliverWebhook(url, { event, payload })).status).toBe(202);
    await dispatcher.settled();
  };

  /** Follows the repository of the fake GitHub named `name`; its Projet's id. */
  const follow = async (name: string): Promise<string> => {
    const repository = (await state()).repositories.find((item) => item.name === name);
    const res = await call('/api/projects', { repositoryIds: [repository?.id], seq: String((await state()).seq) });
    expect(res.status).toBe(201);
    return zProjectList.parse(await res.json()).items[0]?.id ?? '';
  };

  const rows = (): Promise<ChangeRow[]> => sql<ChangeRow>('SELECT * FROM github_changes WHERE pilot_id = $1 ORDER BY seq', [pilotId]);

  let token: string | undefined;

  /** The Pilote's Runner connected again (linked the first time), its hello sent with `mirrorAfter` (left out when undefined) and accepted. */
  const runner = async (mirrorAfter?: number | null): Promise<FakeRunnerClient> => {
    token ??= (await createLinkedRunner(prisma, pilotId)).token;
    const socket = await connectRunner(url, token);
    runners.push(socket);
    socket.hello(mirrorAfter === undefined ? {} : { mirrorAfter });
    await socket.expect('hello.accepted');
    return socket;
  };

  /** Waits until `socket` received `count` Miroir messages, the relay done; their lines. */
  const mirrorLines = async (socket: FakeRunnerClient, count: number): Promise<string[]> => {
    await vi.waitFor(async () => {
      await relay.settled();
      expect(mirrorOf(socket).length).toBeGreaterThanOrEqual(count);
    });
    return lines(mirrorOf(socket));
  };

  beforeEach(async () => {
    await empty();
    fakes.github.reset();
    pilotId = newId();
    token = undefined;
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone, getting_started_step) VALUES ($1, $2, 'octo-fixture', 'Europe/Paris', 'projects')`, [
      pilotId,
      SENDER_ID,
    ]);
    cookie = `${SESSION_COOKIE}=${await runInPilotScope(pilotId, () => app.get(WebSessions).open(prisma.scoped, pilotId, undefined))}`;
    fakes.github.seedRepo({ ...APP_REPO, installationId: INSTALLATION_ID, files: { 'README.md': '# App' } });
    fakes.github.seedRepo({ ...OTHER_REPO, installationId: INSTALLATION_ID, files: { 'README.md': '# Other' } });
    await deliver('installation', webhookFixture('installation.created'));
    projectId = await follow(APP_REPO.name);
  });

  afterEach(async () => {
    await Promise.all(runners.splice(0).map((socket) => socket.close()));
  });

  describe('the envelopes', () => {
    it('a webhook of a Projet writes one row with the next seq of its Pilote, received at, without content', async () => {
      const before = new Date();
      await deliver('pull_request');
      await deliver('push');

      const written = await rows();
      expect(written).toEqual([
        expect.objectContaining({ seq: '1', project_id: projectId, repository: FULL_NAME, kind: 'pull', number: 43, sha: HEAD, ref: null, action: 'synchronize' }),
        expect.objectContaining({ seq: '2', project_id: projectId, repository: FULL_NAME, kind: 'push', number: null, ref: 'refs/heads/develop', action: null }),
      ]);
      expect(written[0]?.at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1);
      const [pilot] = await sql<{ github_change_seq: string; seq: string }>('SELECT github_change_seq, seq FROM pilots WHERE id = $1', [pilotId]);
      expect(pilot?.github_change_seq).toBe('2');
    });

    it('has no column outside the envelope’s', async () => {
      const columns = await sql<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'github_changes'`);
      expect(columns.map((column) => column.column_name).sort()).toEqual(ROW_COLUMNS);
    });

    it('a webhook of a repository that is not a Projet, or of a Projet whose access is lost, writes nothing', async () => {
      await deliver('issues', { ...webhookFixture<Record<string, unknown>>('issues'), repository: { id: OTHER_REPO.id, name: OTHER_REPO.name, full_name: `${OTHER_REPO.owner}/${OTHER_REPO.name}` } });
      await sql('UPDATE projects SET access_lost = true WHERE id = $1', [projectId]);
      await deliver('issues');

      expect(await rows()).toEqual([]);
      const [pilot] = await sql<{ github_change_seq: string }>('SELECT github_change_seq FROM pilots WHERE id = $1', [pilotId]);
      expect(pilot?.github_change_seq).toBe('0');
    });

    it('two deliveries at once get two consecutive seqs', async () => {
      const second = webhookFixture<{ installation: { id: number } }>('issues');
      // Another installation: the dispatcher runs the two deliveries side by side.
      await sql(`INSERT INTO github_installations (installation_id, pilot_id, account_login, account_id, sender_id) VALUES ($1, $2, 'octo-org', 9200001, $3)`, [51000002, pilotId, SENDER_ID]);
      await Promise.all([deliverWebhook(url, { event: 'issues', payload: webhookFixture('issues') }), deliverWebhook(url, { event: 'issues', payload: { ...second, installation: { id: 51000002 } } })]);
      await dispatcher.settled();

      expect((await rows()).map((row) => row.seq)).toEqual(['1', '2']);
    });
  });

  describe('the Runner’s replay', () => {
    it('a hello with mirrorAfter gets the Projets, the changes after it in order, then mirror.live, then the changes as they come', async () => {
      for (const event of ['issues', 'issue_comment', 'pull_request', 'check_suite', 'push']) await deliver(event);
      const socket = await runner(3);

      expect(await mirrorLines(socket, 4)).toEqual(['projects', 'change 4', 'change 5', 'live 5']);
      await deliver('release');
      expect(await mirrorLines(socket, 5)).toEqual(['projects', 'change 4', 'change 5', 'live 5', 'change 6']);
    });

    it('sends each change as its envelope, the keys of the contract and no other', async () => {
      const socket = await runner(0);
      await mirrorLines(socket, 2);
      await deliver('pull_request');
      await mirrorLines(socket, 3);

      const change = mirrorOf(socket).find((message) => message.type === 'github.changed');
      expect(change?.type === 'github.changed' && Object.keys(change.change).sort()).toEqual(CHANGE_KEYS);
      const [row] = await rows();
      expect(change).toMatchObject({ change: { seq: 1, projectId, repository: FULL_NAME, kind: 'pull', number: 43, sha: HEAD, ref: null, action: 'synchronize', at: row?.at.toISOString() } });
    });

    it('webhooks during the replay are sent once each, in order, without a hole', async () => {
      for (const event of ['issues', 'pull_request']) await deliver(event);
      const events = ['issue_comment', 'check_run', 'push', 'label', 'milestone', 'release'];
      const [socket] = await Promise.all([runner(0), (async () => { for (const event of events) await deliver(event); })()]);

      const seen = await mirrorLines(socket, 2 + 8);
      expect(seen.filter((line) => line.startsWith('change '))).toEqual(['change 1', 'change 2', 'change 3', 'change 4', 'change 5', 'change 6', 'change 7', 'change 8']);
      expect(seen[0]).toBe('projects');
      // mirror.live says the last seq the replay sent: the changes after it are newer.
      const live = seen.findIndex((line) => line.startsWith('live '));
      const liveSeq = Number(seen[live]?.slice('live '.length));
      const seqs = (from: number, to?: number) => seen.slice(from, to).map((line) => Number(line.slice('change '.length)));
      expect(seqs(1, live).every((seq) => seq <= liveSeq)).toBe(true);
      expect(seqs(live + 1).every((seq) => seq > liveSeq)).toBe(true);
    });

    it('a change relayed ahead of an older one sends the older first, read from github_changes, and each once', async () => {
      const socket = await runner(0);
      await mirrorLines(socket, 2);
      // Two commits whose relays arrive in the other order: 2 is published before 1.
      await sql(`INSERT INTO github_changes (pilot_id, seq, project_id, repository, kind, number, at) VALUES ($1, 1, $2, $3, 'issue', 42, now()), ($1, 2, $2, $3, 'issue', 43, now())`, [pilotId, projectId, FULL_NAME]);
      await sql('UPDATE pilots SET github_change_seq = 2 WHERE id = $1', [pilotId]);
      const change = (seq: number, number: number) => ({ seq, projectId, repository: FULL_NAME, kind: 'issue' as const, number, sha: null, ref: null, action: null, at: new Date().toISOString() });
      relay.publish(pilotId, change(2, 43));
      relay.publish(pilotId, change(1, 42));

      expect(await mirrorLines(socket, 4)).toEqual(['projects', 'live 0', 'change 1', 'change 2']);
      await relay.settled();
      expect(lines(mirrorOf(socket))).toEqual(['projects', 'live 0', 'change 1', 'change 2']);
    });

    it('a Runner without a Miroir (mirrorAfter null) gets mirror.resync, then mirror.live at the last seq', async () => {
      for (const event of ['issues', 'push']) await deliver(event);
      const socket = await runner(null);

      expect(await mirrorLines(socket, 3)).toEqual(['projects', 'resync', 'live 2']);
      await deliver('label');
      expect(await mirrorLines(socket, 4)).toEqual(['projects', 'resync', 'live 2', 'change 3']);
    });

    it('a mirrorAfter older than the oldest change kept, or beyond the last seq, gets mirror.resync', async () => {
      for (const event of ['issues', 'push', 'label']) await deliver(event);
      await sql('DELETE FROM github_changes WHERE pilot_id = $1 AND seq = 1', [pilotId]);

      expect(await mirrorLines(await runner(0), 3)).toEqual(['projects', 'resync', 'live 3']);
      expect(await mirrorLines(await runner(1), 4)).toEqual(['projects', 'change 2', 'change 3', 'live 3']);
      expect(await mirrorLines(await runner(9), 3)).toEqual(['projects', 'resync', 'live 3']);
    });

    it('a change missing between two kept ones gets mirror.resync, not a replay with a hole', async () => {
      for (const event of ['issues', 'push', 'label']) await deliver(event);
      await sql('DELETE FROM github_changes WHERE pilot_id = $1 AND seq = 2', [pilotId]);

      expect(await mirrorLines(await runner(0), 3)).toEqual(['projects', 'resync', 'live 3']);
      expect(await mirrorLines(await runner(2), 3)).toEqual(['projects', 'change 3', 'live 3']);
    });

    it('a change missing behind a live one gets mirror.resync then mirror.live at its seq, never a hole', async () => {
      const socket = await runner(0);
      await mirrorLines(socket, 2);
      // 1 purged before its relay came: 3 arrives with only 2 kept behind it.
      await sql(`INSERT INTO github_changes (pilot_id, seq, project_id, repository, kind, number, at) VALUES ($1, 2, $2, $3, 'issue', 42, now()), ($1, 3, $2, $3, 'issue', 43, now())`, [pilotId, projectId, FULL_NAME]);
      await sql('UPDATE pilots SET github_change_seq = 3 WHERE id = $1', [pilotId]);
      relay.publish(pilotId, { seq: 3, projectId, repository: FULL_NAME, kind: 'issue', number: 43, sha: null, ref: null, action: null, at: new Date().toISOString() });

      expect(await mirrorLines(socket, 4)).toEqual(['projects', 'live 0', 'resync', 'live 3']);
      await deliver('push');
      expect(await mirrorLines(socket, 5)).toEqual(['projects', 'live 0', 'resync', 'live 3', 'change 4']);
    });

    it('a Runner up to date gets mirror.live alone after its Projets', async () => {
      await deliver('issues');
      expect(await mirrorLines(await runner(1), 2)).toEqual(['projects', 'live 1']);
      expect(await mirrorLines(await runner(0), 3)).toEqual(['projects', 'change 1', 'live 1']);
    });

    it('a hello without mirrorAfter gets no message of the Miroir', async () => {
      await deliver('issues');
      const socket = await runner();
      await deliver('push');
      await relay.settled();

      expect(mirrorOf(socket)).toEqual([]);
      expect(await rows()).toHaveLength(2);
    });

    it('a replaced Runner gets nothing more: the new one has the stream', async () => {
      const first = await runner(0);
      await mirrorLines(first, 2);
      const second = await runner(0);
      await mirrorLines(second, 2);
      await deliver('issues');

      expect(await mirrorLines(second, 3)).toEqual(['projects', 'live 0', 'change 1']);
      expect(lines(mirrorOf(first))).toEqual(['projects', 'live 0']);
    });
  });

  describe('the Projets of the Miroir', () => {
    it('lists each Projet with its repository, its ids, its name and its integration branch', async () => {
      const socket = await runner(0);
      await mirrorLines(socket, 2);

      const [message] = mirrorOf(socket);
      expect(message?.type === 'mirror.projects' && message.projects).toEqual([
        { projectId, repository: FULL_NAME, githubRepoId: APP_REPO.id, installationId: INSTALLATION_ID, displayName: expect.any(String), integrationBranch: expect.any(String) },
      ]);
    });

    it('sends them again when a Projet is followed, or its access lost', async () => {
      const socket = await runner(0);
      await mirrorLines(socket, 2);
      const otherId = await follow(OTHER_REPO.name);

      expect(await mirrorLines(socket, 3)).toEqual(['projects', 'live 0', 'projects']);
      const followed = mirrorOf(socket)[2];
      expect(followed?.type === 'mirror.projects' && followed.projects.map((project: MirrorProject) => project.projectId).sort()).toEqual([projectId, otherId].sort());

      await deliver('installation', webhookFixture('installation.deleted'));
      expect(await mirrorLines(socket, 4)).toEqual(['projects', 'live 0', 'projects', 'projects']);
      const lost = mirrorOf(socket)[3];
      expect(lost?.type === 'mirror.projects' && lost.projects).toEqual([]);
    });
  });

  describe('a repository renamed on GitHub', () => {
    it('renames its Projet: mirror.projects and the next envelopes say the new name', async () => {
      const socket = await runner(0);
      await mirrorLines(socket, 2);
      fakes.github.reset();
      fakes.github.seedRepo({ ...APP_REPO, name: 'renamed-app', installationId: INSTALLATION_ID, files: { 'README.md': '# App' } });
      fakes.github.seedRepo({ ...OTHER_REPO, installationId: INSTALLATION_ID, files: { 'README.md': '# Other' } });
      await deliver('installation', webhookFixture('installation.created'));

      expect(await mirrorLines(socket, 3)).toEqual(['projects', 'live 0', 'projects']);
      const renamed = mirrorOf(socket)[2];
      expect(renamed?.type === 'mirror.projects' && renamed.projects.map((project: MirrorProject) => project.repository)).toEqual([`${APP_REPO.owner}/renamed-app`]);
      await deliver('issues');
      expect((await rows()).map((row) => row.repository)).toEqual([`${APP_REPO.owner}/renamed-app`]);
      expect(await mirrorLines(socket, 4)).toEqual(['projects', 'live 0', 'projects', 'change 1']);
      const [project] = (await state()).projects;
      expect(project).toMatchObject({ id: projectId, name: 'renamed-app', fullName: `${APP_REPO.owner}/renamed-app` });
    });
  });

  describe('the retention', () => {
    it('deletes the changes received more than 7 days ago and keeps the others', async () => {
      for (const event of ['issues', 'push']) await deliver(event);
      const now = new Date();
      await sql('UPDATE github_changes SET at = $2 WHERE pilot_id = $1 AND seq = 1', [pilotId, new Date(now.getTime() - GITHUB_CHANGES_KEPT_MS - 1000)]);
      await sql('UPDATE github_changes SET at = $2 WHERE pilot_id = $1 AND seq = 2', [pilotId, new Date(now.getTime() - GITHUB_CHANGES_KEPT_MS + 60_000)]);

      expect(await app.get(GitHubChangesRetention).purge(now)).toBe(1);
      expect((await rows()).map((row) => row.seq)).toEqual(['2']);
    });
  });
});
