import { zProject, zProjectList, zRepository, zState } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject, vi } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { githubUnavailable } from '../../src/github/github.errors.js';
import { Reconciliation } from '../../src/github/reconciliation/reconciliation.service.js';
import { WebhookDispatcher } from '../../src/github/webhooks/dispatcher.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import { deliverWebhook, TEST_WEBHOOK_SECRET, webhookFixture } from '../fakes/github.js';
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

/** The GitHub user who installs the App in the fixtures, and their installation. */
const SENDER_ID = 9100001;
const INSTALLATION_ID = 51000001;
const created = webhookFixture<Record<string, unknown>>('installation.created');
const deleted = webhookFixture<Record<string, unknown>>('installation.deleted');

const APP_REPO = { owner: 'octo-fixture', name: 'fixture-app', id: 71000001 };
const NEW_REPO = { owner: 'octo-fixture', name: 'new-idea', id: 71000002 };

const repositoriesEvent = (action: 'added' | 'removed', repos: { owner: string; name: string; id: number }[]) => ({
  action,
  installation: { id: INSTALLATION_ID },
  repository_selection: 'selected',
  [action === 'added' ? 'repositories_added' : 'repositories_removed']: repos.map((repo) => ({ id: repo.id, name: repo.name, full_name: `${repo.owner}/${repo.name}`, private: true })),
  sender: { id: SENDER_ID, login: 'octo-fixture' },
});

interface Tab {
  id: string;
  cookie: string;
}

interface EventRow {
  type: string;
  payload: Record<string, unknown>;
  source: string | null;
}

describe('the Dépôts GitHub and the Projets against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let fakes: Fakes;
  let dispatcher: WebhookDispatcher;

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    prisma = app.get(PrismaService);
    fakes = app.get<Fakes>(FAKES);
    dispatcher = app.get(WebhookDispatcher);
  });

  const empty = () => sql('TRUNCATE pilots, github_installations, github_deliveries CASCADE');

  afterAll(async () => {
    await empty();
    await app.close();
  });

  let alice: Tab;

  const pilot = async (githubUserId: number, login: string): Promise<Tab> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone, getting_started_step) VALUES ($1, $2, $3, 'Europe/Paris', 'projects')`, [id, githubUserId, login]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  beforeEach(async () => {
    await empty();
    fakes.github.reset();
    alice = await pilot(SENDER_ID, 'octo-fixture');
    // One repository with code (three commits), one with its initial commit alone.
    fakes.github.seedRepo({
      ...APP_REPO,
      installationId: INSTALLATION_ID,
      files: { '.process.json': JSON.stringify({ projectName: 'Fixture App', branches: { integration: 'dev', release: 'prod' } }) },
    });
    await fakes.github.pushCommit(APP_REPO, 'main', { 'src/main.ts': 'code' });
    await fakes.github.pushCommit(APP_REPO, 'main', { 'src/main.ts': 'more code' });
    fakes.github.seedRepo({ ...NEW_REPO, installationId: INSTALLATION_ID, private: false, files: { 'README.md': '# New' } });
  });

  const deliver = async (event: string, payload: unknown): Promise<void> => {
    const res = await deliverWebhook(url, { event, payload });
    expect(res.status).toBe(202);
    await dispatcher.settled();
  };

  const call = (tab: Tab | undefined, path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(tab ? { cookie: tab.cookie } : {}), origin: ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    });

  const state = async (tab: Tab) => zState.parse(await (await call(tab, '/api/state')).json());

  const eventsOf = (tab: Tab): Promise<EventRow[]> => sql<EventRow>('SELECT type, payload, source FROM events WHERE pilot_id = $1 ORDER BY seq', [tab.id]);

  /** The App installed on the two repositories, and the Dépôts GitHub it gave. */
  const install = async (tab: Tab = alice) => {
    await deliver('installation', created);
    return (await state(tab)).repositories;
  };

  const follow = async (tab: Tab, repositoryIds: string[], seq?: number): Promise<Response> =>
    call(tab, '/api/projects', { repositoryIds, seq: String(seq ?? (await state(tab)).seq) });

  describe('the webhooks', () => {
    it('installation.created makes every repository a Dépôt GitHub within 2 s, with or without code, as repository.upserted from GitHub', async () => {
      const startedAt = Date.now();
      const repositories = await install();

      expect(Date.now() - startedAt).toBeLessThan(2000);
      expect(repositories.map(({ fullName, private: isPrivate, defaultBranch, hasCode, followed }) => ({ fullName, isPrivate, defaultBranch, hasCode, followed }))).toEqual([
        { fullName: 'octo-fixture/fixture-app', isPrivate: true, defaultBranch: 'main', hasCode: true, followed: false },
        { fullName: 'octo-fixture/new-idea', isPrivate: false, defaultBranch: 'main', hasCode: false, followed: false },
      ]);
      const events = await eventsOf(alice);
      expect(events.map((event) => [event.type, event.source])).toEqual([
        ['repository.upserted', 'github'],
        ['repository.upserted', 'github'],
      ]);
      for (const event of events) zRepository.parse(event.payload);
    });

    it('writes nothing when the reconciliation finds the repositories as they are', async () => {
      await install();
      const before = (await eventsOf(alice)).length;

      await app.get(Reconciliation).run();

      expect(await eventsOf(alice)).toHaveLength(before);
    });

    it('installation_repositories.added adds only the repositories it names', async () => {
      await install();
      const third = { owner: 'octo-fixture', name: 'third', id: 71000003 };
      fakes.github.seedRepo({ ...third, installationId: INSTALLATION_ID });

      await deliver('installation_repositories', repositoriesEvent('added', [third]));

      expect((await state(alice)).repositories.map((repository) => repository.name)).toEqual(['fixture-app', 'new-idea', 'third']);
    });

    it('installation_repositories.removed takes the repository out of the picker and marks its Projet accessLost; added back, the Projet has its access again', async () => {
      const [withCode] = await install();
      const [project] = zProjectList.parse(await (await follow(alice, [withCode?.id ?? ''])).json()).items;

      fakes.github.removeFromInstallation(APP_REPO);
      await deliver('installation_repositories', repositoriesEvent('removed', [APP_REPO]));

      const lost = await state(alice);
      expect(lost.repositories.map((repository) => repository.name)).toEqual(['new-idea']);
      expect(lost.projects).toEqual([expect.objectContaining({ id: project?.id, accessLost: true })]);
      const events = await eventsOf(alice);
      expect(events.slice(-2).map((event) => [event.type, event.payload])).toEqual([
        ['repository.removed', { id: withCode?.id }],
        ['project.upserted', expect.objectContaining({ id: project?.id, accessLost: true })],
      ]);

      fakes.github.seedRepo({ ...APP_REPO, installationId: INSTALLATION_ID });
      await deliver('installation_repositories', repositoriesEvent('added', [APP_REPO]));

      const back = await state(alice);
      expect(back.repositories.map((repository) => repository.name)).toEqual(['new-idea']);
      expect(back.projects).toEqual([expect.objectContaining({ id: project?.id, repositoryId: withCode?.id, accessLost: false })]);
    });

    it('the reconciliation removes a repository whose webhook was lost', async () => {
      await install();
      fakes.github.removeFromInstallation(NEW_REPO);

      await app.get(Reconciliation).run();

      expect((await state(alice)).repositories.map((repository) => repository.name)).toEqual(['fixture-app']);
    });

    it('the reconciliation counts the commits again: a history rewritten to one commit has no code any more', async () => {
      await install();
      fakes.github.squashBranch(APP_REPO, 'main');

      await app.get(Reconciliation).run();

      expect((await state(alice)).repositories.map(({ name, hasCode }) => ({ name, hasCode }))).toEqual([
        { name: 'fixture-app', hasCode: false },
        { name: 'new-idea', hasCode: false },
      ]);
    });

    it('a removal delivered while the reconciliation reads GitHub is applied after it, never undone by it', async () => {
      const [withCode] = await install();
      const [project] = zProjectList.parse(await (await follow(alice, [withCode?.id ?? ''])).json()).items;
      let release = (): void => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const read = fakes.github.getDefaultBranch.bind(fakes.github);
      const paused = vi.spyOn(fakes.github, 'getDefaultBranch').mockImplementationOnce(async (repo) => {
        await gate;
        return read(repo);
      });
      try {
        // The reconciliation has listed both repositories, and waits on GitHub.
        const reconciling = app.get(Reconciliation).run();
        await vi.waitFor(() => expect(paused).toHaveBeenCalled());

        fakes.github.removeFromInstallation(APP_REPO);
        expect((await deliverWebhook(url, { event: 'installation_repositories', payload: repositoriesEvent('removed', [APP_REPO]) })).status).toBe(202);
        await Promise.race([dispatcher.settled(), new Promise((resolve) => setTimeout(resolve, 300))]);
        release();
        await reconciling;
        await dispatcher.settled();
      } finally {
        paused.mockRestore();
      }

      const after = await state(alice);
      expect(after.repositories.map((repository) => repository.name)).toEqual(['new-idea']);
      expect(after.projects).toEqual([expect.objectContaining({ id: project?.id, accessLost: true })]);
    });

    it('the reconciliation finds an installation uninstalled whose webhook was lost: its repositories leave, their Projets lose access, the installation leaves the index', async () => {
      const [withCode] = await install();
      const [project] = zProjectList.parse(await (await follow(alice, [withCode?.id ?? ''])).json()).items;
      fakes.github.uninstall(INSTALLATION_ID);

      await app.get(Reconciliation).run();

      const after = await state(alice);
      expect(after.repositories).toEqual([]);
      expect(after.projects).toEqual([expect.objectContaining({ id: project?.id, accessLost: true })]);
      expect(await sql('SELECT installation_id FROM github_installations WHERE installation_id = $1', [INSTALLATION_ID])).toEqual([]);
    });

    it('keeps the repositories when GitHub only fails for a while', async () => {
      await install();
      const failing = vi.spyOn(fakes.github, 'listInstallationRepositories').mockRejectedValueOnce(githubUnavailable());
      try {
        await app.get(Reconciliation).run();
      } finally {
        failing.mockRestore();
      }

      expect((await state(alice)).repositories.map((repository) => repository.name)).toEqual(['fixture-app', 'new-idea']);
    });

    it('installation.deleted removes every repository of the installation', async () => {
      await install();

      await deliver('installation', deleted);

      expect((await state(alice)).repositories).toEqual([]);
    });
  });

  describe('POST /api/projects', () => {
    it('follows two repositories: 201, named and branched after .process.json when present, pending for the one with code, with its events in one transaction', async () => {
      const repositories = await install();
      const before = (await eventsOf(alice)).length;

      const res = await follow(alice, repositories.map((repository) => repository.id));

      expect(res.status).toBe(201);
      const { items } = zProjectList.parse(await res.json());
      expect(items.map(({ displayName, fullName, integrationBranch, releaseBranch, hasCode, inventoryState, accessLost }) => ({ displayName, fullName, integrationBranch, releaseBranch, hasCode, inventoryState, accessLost }))).toEqual([
        { displayName: 'Fixture App', fullName: 'octo-fixture/fixture-app', integrationBranch: 'dev', releaseBranch: 'prod', hasCode: true, inventoryState: 'pending', accessLost: false },
        { displayName: 'new-idea', fullName: 'octo-fixture/new-idea', integrationBranch: 'develop', releaseBranch: 'main', hasCode: false, inventoryState: 'not-needed', accessLost: false },
      ]);
      const events = (await eventsOf(alice)).slice(before);
      expect(events.map((event) => event.type)).toEqual(['project.upserted', 'repository.upserted', 'project.upserted', 'repository.upserted']);
      expect(events.filter((event) => event.type === 'repository.upserted').map((event) => zRepository.parse(event.payload).followed)).toEqual([true, true]);
      for (const event of events.filter((event) => event.type === 'project.upserted')) zProject.parse(event.payload);

      const after = await state(alice);
      expect(after.repositories).toEqual([]);
      expect(after.projects.map((project) => project.displayName)).toEqual(['Fixture App', 'new-idea']);
      expect(zProjectList.parse(await (await call(alice, '/api/projects')).json()).items).toEqual(after.projects);
      expect(zProject.parse(await (await call(alice, `/api/projects/${items[0]?.id}`)).json())).toEqual(items[0]);
    });

    it('answers 400 with fields for no repository, or an id that is not one', async () => {
      await expectFields(await call(alice, '/api/projects', { repositoryIds: [], seq: '0' }), ['repositoryIds']);
      await expectFields(await call(alice, '/api/projects', { repositoryIds: ['nope'], seq: '0' }), ['repositoryIds.0']);
    });

    it('answers 401 without a session', async () => {
      await expectEnvelope(await call(undefined, '/api/projects', { repositoryIds: [newId()], seq: '0' }), 401, 'auth.required');
      await expectEnvelope(await call(undefined, '/api/projects'), 401, 'auth.required');
    });

    it('answers 404 for an unknown repository or another Pilote’s, and creates nothing', async () => {
      const [mine] = await install();
      const bob = await pilot(9100002, 'bob');

      await expectEnvelope(await follow(bob, [mine?.id ?? '']), 404, 'project.repository-not-found');
      await expectEnvelope(await follow(alice, [newId()]), 404, 'project.repository-not-found');
      expect(await sql('SELECT id FROM projects')).toEqual([]);
    });

    it('answers 422 project.already-followed for a repository already a Projet, and creates nothing more', async () => {
      const [first, second] = await install();
      expect((await follow(alice, [first?.id ?? ''])).status).toBe(201);

      const envelope = await expectEnvelope(await follow(alice, [second?.id ?? '', first?.id ?? '']), 422, 'project.already-followed');

      expect(envelope.message).toBe('Ce dépôt est déjà un Projet.');
      expect(await sql('SELECT id FROM projects')).toHaveLength(1);
    });

    it('follows a repository once when two tabs follow it at the same time: the other gets 422 project.already-followed or 409 realtime.stale, never a 500', async () => {
      const [first] = await install();
      const { seq } = await state(alice);

      const responses = await Promise.all([follow(alice, [first?.id ?? ''], seq), follow(alice, [first?.id ?? ''], seq)]);

      const statuses = responses.map((res) => res.status).sort();
      expect(statuses[0]).toBe(201);
      expect([409, 422]).toContain(statuses[1]);
      expect(await sql('SELECT id FROM projects')).toHaveLength(1);
    });

    it('answers 409 realtime.stale when the repository changed since the page’s seq', async () => {
      const [first] = await install();

      await expectEnvelope(await follow(alice, [first?.id ?? ''], 0), 409, 'realtime.stale');
    });
  });

  describe('GET /api/projects/:id', () => {
    it('answers 404 project.not-found for another Pilote’s Projet, or an id that is not one', async () => {
      const [first] = await install();
      const [project] = zProjectList.parse(await (await follow(alice, [first?.id ?? ''])).json()).items;
      const bob = await pilot(9100002, 'bob');

      await expectEnvelope(await call(bob, `/api/projects/${project?.id}`), 404, 'project.not-found');
      await expectEnvelope(await call(alice, '/api/projects/nope'), 404, 'project.not-found');
      expect(zProjectList.parse(await (await call(bob, '/api/projects')).json()).items).toEqual([]);
    });
  });

  describe('GET /api/github/setup', () => {
    it('sends the browser back to the picker it left, without a session', async () => {
      const back = (query: string) => call(undefined, `/api/github/setup?${query}`).then((res) => [res.status, res.headers.get('location')]);

      expect(await back(`installation_id=${INSTALLATION_ID}&setup_action=install&state=demarrage`)).toEqual([302, '/demarrage']);
      expect(await back(`installation_id=${INSTALLATION_ID}&setup_action=update&state=projets`)).toEqual([302, '/projets/ajouter']);
      expect(await back('setup_action=update')).toEqual([302, '/projets/ajouter']);
    });
  });
});
