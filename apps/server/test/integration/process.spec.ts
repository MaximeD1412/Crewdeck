import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROCESS_CREWDECK,
  PROCESS_CREWDECK_NAME,
  type ProcessDefinition,
  type ProcessDraftInput,
  type ProjectProcess,
  processSourcesOf,
  zProjectList,
  zProjectProcess,
  zState,
} from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { WebhookDispatcher } from '../../src/github/webhooks/dispatcher.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { ProcessBackfill } from '../../src/process/process-backfill.js';
import { SourcesService } from '../../src/process/sources/sources.service.js';
import { Transactions } from '../../src/realtime/transactions.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { roleUsage } from '../../src/settings/role-usage.js';
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
const APP_REPO = { owner: 'octo-fixture', name: 'fixture-app', id: 71000001 };

const FIXTURES = join(import.meta.dirname, '../../../../packages/contracts/fixtures/process');
const MIGRATIONS = join(import.meta.dirname, '../../prisma/migrations');
interface Fixture {
  readonly definition: ProcessDefinition;
  readonly refusals: readonly { kind: string; target: string; label: string }[];
}
const fixture = (name: string): Fixture => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as Fixture;
/** Every fixture `validateDefinition` refuses: one per refusal kind, and their combination. */
const REFUSED = readdirSync(FIXTURES)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.slice(0, -'.json'.length))
  .filter((name) => fixture(name).refusals.length > 0)
  .sort();

const bytes = (length: number, fill: number): string => Buffer.alloc(length, fill).toString('base64url');
const SEALED = { key: bytes(60, 3), ciphertext: bytes(48, 9) };

/** « Process Crewdeck » with one Commande, named by the Étape « Checks ». */
const withCommand = (): ProcessDefinition => {
  const definition = structuredClone(PROCESS_CREWDECK);
  definition.commands.push({ id: 'e2e' });
  return definition;
};

interface Tab {
  id: string;
  cookie: string;
}

interface EventRow {
  type: string;
  payload: Record<string, unknown>;
  tx: string;
}

describe('the Process of a Projet against PostgreSQL', () => {
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

  const pilot = async (githubUserId: number, login: string): Promise<Tab> => {
    const id = newId();
    await sql(`WITH p AS (INSERT INTO pilots (id, display_name, time_zone, getting_started_step) VALUES ($1, $3, 'Europe/Paris', 'projects') RETURNING id) INSERT INTO pilot_identities (id, pilot_id, provider, subject, login) SELECT gen_random_uuid(), id, 'github', $2::text, $3 FROM p`, [id, githubUserId, login]);
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
  /** When Alice's Projet started being followed, and when it was. */
  let followedFrom: number;
  let followedTo: number;

  /** Alice follows the fixture's repository: her Projet, as `POST /api/projects` creates it. */
  const follow = async (tab: Tab): Promise<string> => {
    const res = await deliverWebhook(url, { event: 'installation', payload: created });
    expect(res.status).toBe(202);
    await dispatcher.settled();
    const { seq, repositories } = await state(tab);
    const followed = await call(tab, 'POST', '/api/projects', { repositoryIds: repositories.map((repository) => repository.id), seq: String(seq) });
    expect(followed.status).toBe(201);
    const [project] = zProjectList.parse(await followed.json()).items;
    return project?.id ?? '';
  };

  beforeEach(async () => {
    await empty();
    fakes.github.reset();
    fakes.github.seedRepo({ ...APP_REPO, installationId: INSTALLATION_ID, files: { 'README.md': '# App' } });
    alice = await pilot(SENDER_ID, 'octo-fixture');
    followedFrom = Date.now();
    projectId = await follow(alice);
    followedTo = Date.now();
  });

  const getProcess = (tab: Tab | undefined, id = projectId) => call(tab, 'GET', `/api/projects/${id}/process`);
  const save = (tab: Tab, input: Partial<ProcessDraftInput>, id = projectId) =>
    call(tab, 'PUT', `/api/projects/${id}/process/draft`, { definition: PROCESS_CREWDECK, sealed: null, revision: 0, baseVersion: 1, ...input });
  const saved = async (res: Response): Promise<ProjectProcess> => {
    expect(res.status).toBe(200);
    return zProjectProcess.parse(await res.json());
  };

  describe('the creation of a Projet', () => {
    it('gives version 1, « Process Crewdeck » activated by the creation, no draft; its process.upserted in the Projet’s transaction; GET /api/state lists it', async () => {
      const view = await saved(await getProcess(alice));

      expect(view).toEqual({
        id: projectId,
        active: { number: 1, definition: PROCESS_CREWDECK, sealed: null, activatedAt: expect.any(String), activatedBy: 'creation', templateName: PROCESS_CREWDECK_NAME },
        draft: null,
        sources: { ticket: { source: 'github', since: expect.any(String) }, code: { source: 'github', since: expect.any(String) } },
        running: [],
      });
      const events = await eventsOf(alice);
      const project = events.find((event) => event.type === 'project.upserted');
      const process = events.find((event) => event.type === 'process.upserted');
      expect(zProjectProcess.parse(process?.payload)).toEqual(view);
      expect(process?.tx).toBe(project?.tx);
      expect((await state(alice)).processes).toEqual([view]);
    });

    it('is version 1 after the server starts for a Projet followed before, and only one after two starts', async () => {
      await sql('DELETE FROM process_versions');
      await sql('DELETE FROM events');

      expect(await app.get(ProcessBackfill).run()).toBe(1);
      expect(await app.get(ProcessBackfill).run()).toBe(0);

      expect(await sql('SELECT number, activated_by FROM process_versions WHERE project_id = $1', [projectId])).toEqual([{ number: 1, activated_by: 'creation' }]);
      expect((await eventsOf(alice)).map((event) => event.type)).toEqual(['process.upserted']);
      expect((await saved(await getProcess(alice))).active?.definition).toEqual(PROCESS_CREWDECK);
    });

    it('gives the Projets of the « projets » scenario their version 1 too', async () => {
      const res = await fetch(`${url}/api/testing/scenarios/projets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const { sessionCookie } = (await res.json()) as { sessionCookie: string };
      const [octocat] = await sql<{ id: string }>(`SELECT id FROM pilots WHERE display_name = 'octocat'`);

      const { projects, processes } = await state({ id: octocat?.id ?? '', cookie: sessionCookie });

      expect(projects.length).toBeGreaterThan(0);
      expect(processes.map((process) => [process.id, process.active?.number, process.active?.templateName])).toEqual(
        projects.map((project) => [project.id, 1, PROCESS_CREWDECK_NAME]).sort(([a], [b]) => String(a).localeCompare(String(b))),
      );
    });

    it('cannot update a process_versions row: the trigger refuses it', async () => {
      await expect(sql(`UPDATE process_versions SET template_name = 'Autre' WHERE project_id = $1`, [projectId])).rejects.toThrow(/process_versions rows are immutable/);
      expect(await sql('SELECT template_name FROM process_versions')).toEqual([{ template_name: PROCESS_CREWDECK_NAME }]);
    });
  });

  describe('the Sources of a Projet', () => {
    const inAlice = <T>(fn: (sources: SourcesService, tx: Parameters<Parameters<Transactions['run']>[0]>[0]) => Promise<T>): Promise<T> =>
      runInPilotScope(alice.id, () => app.get(Transactions).run((tx) => fn(app.get(SourcesService), tx)));
    const rows = () => sql<{ group: string; source: string }>(`SELECT "group", source FROM artifact_sources WHERE project_id = $1 ORDER BY "group"`, [projectId]);

    it('puts both groups of a Projet followed from a Dépôt GitHub on GitHub, since its creation, in the view and its first process.upserted', async () => {
      const view = await saved(await getProcess(alice));

      expect(view.sources).toEqual({ ticket: { source: 'github', since: view.sources.code.since }, code: { source: 'github', since: expect.any(String) } });
      const since = Date.parse(view.sources.code.since);
      expect(since).toBeGreaterThanOrEqual(followedFrom);
      expect(since).toBeLessThanOrEqual(followedTo);
      const events = await eventsOf(alice);
      const first = events.find((event) => event.type === 'process.upserted');
      expect(zProjectProcess.parse(first?.payload).sources).toEqual(view.sources);
      expect(await inAlice((sources, tx) => sources.sourcesOf(tx, projectId))).toEqual({ ticket: 'github', code: 'github' });
    });

    it('puts both groups Local with createDefaults(…, local), and the view shows them', async () => {
      await sql('DELETE FROM artifact_sources WHERE project_id = $1', [projectId]);

      await inAlice((sources, tx) => sources.createDefaults(tx, projectId, 'local'));

      expect(await rows()).toEqual([
        { group: 'ticket', source: 'local' },
        { group: 'code', source: 'local' },
      ]);
      const view = await saved(await getProcess(alice));
      expect(view.sources).toEqual({ ticket: { source: 'local', since: expect.any(String) }, code: { source: 'local', since: expect.any(String) } });
      expect((await state(alice)).processes.map((process) => process.sources)).toEqual([view.sources]);
      expect(await inAlice((sources, tx) => sources.sourcesOf(tx, projectId))).toEqual({ ticket: 'local', code: 'local' });
    });

    it('refuses a second row of one group: a second createDefaults for the same Projet fails on the unique index', async () => {
      await expect(inAlice((sources, tx) => sources.createDefaults(tx, projectId, 'local'))).rejects.toMatchObject({ code: 'P2002' });
      await expect(
        sql(`INSERT INTO artifact_sources (id, pilot_id, project_id, "group", source, since) VALUES ($1, $2, $3, 'code', 'local', now())`, [newId(), alice.id, projectId]),
      ).rejects.toThrow(/artifact_sources_project_id_group_key/);

      expect(await rows()).toEqual([
        { group: 'ticket', source: 'github' },
        { group: 'code', source: 'github' },
      ]);
    });

    it('gives a Projet followed before this ticket both groups on GitHub, since it was followed, with the migration’s backfill', async () => {
      const migration = readFileSync(join(MIGRATIONS, '20261126000000_artifact_sources/migration.sql'), 'utf8');
      const backfill = migration.slice(migration.indexOf('INSERT INTO'));
      await sql('DELETE FROM artifact_sources');

      await sql(backfill);

      const backfilled = await sql<{ group: string; source: string; same: boolean }>(
        `SELECT s."group", s.source, s.since = p.followed_at AS same, s.pilot_id = p.pilot_id AS pilot FROM artifact_sources s JOIN projects p ON p.id = s.project_id ORDER BY s."group"`,
      );
      expect(backfilled).toEqual([
        { group: 'ticket', source: 'github', same: true, pilot: true },
        { group: 'code', source: 'github', same: true, pilot: true },
      ]);
      expect((await saved(await getProcess(alice))).sources.ticket.source).toBe('github');
    });
    it('completes at the server’s start the Sources of a Projet a previous release followed after the migration, since it was followed, once', async () => {
      // Followed by the previous release after the migration ran (a deploy, or its rollback): a Process, no Sources.
      await sql('DELETE FROM artifact_sources WHERE project_id = $1', [projectId]);
      await expectEnvelope(await call(alice, 'GET', '/api/state'), 500, 'server.internal');

      expect(await app.get(ProcessBackfill).completeSources()).toBe(1);
      expect(await app.get(ProcessBackfill).completeSources()).toBe(0);

      expect(await sql(`SELECT s."group", s.source, s.since = p.followed_at AS same FROM artifact_sources s JOIN projects p ON p.id = s.project_id ORDER BY s."group"`)).toEqual([
        { group: 'ticket', source: 'github', same: true },
        { group: 'code', source: 'github', same: true },
      ]);
      expect((await state(alice)).processes.map((process) => process.sources.code.source)).toEqual(['github']);
    });

    it('completes a Projet holding one group only', async () => {
      await sql(`DELETE FROM artifact_sources WHERE project_id = $1 AND "group" = 'code'`, [projectId]);

      expect(await app.get(ProcessBackfill).completeSources()).toBe(1);

      expect(await rows()).toEqual([
        { group: 'ticket', source: 'github' },
        { group: 'code', source: 'github' },
      ]);
    });

    it('gives a Projet with neither Sources nor Process its Sources first at the start, then its version 1 on them', async () => {
      await sql('DELETE FROM artifact_sources WHERE project_id = $1', [projectId]);
      await sql('DELETE FROM process_versions WHERE project_id = $1', [projectId]);

      expect(await app.get(ProcessBackfill).run()).toBe(1);

      const view = await saved(await getProcess(alice));
      expect(view.active?.number).toBe(1);
      expect(view.draft).toBeNull();
      expect(processSourcesOf(view)).toEqual({ ticket: 'github', code: 'github' });
    });
  });

  describe('GET /api/projects/:id/process', () => {
    it('answers 401 without a session', async () => {
      await expectEnvelope(await getProcess(undefined), 401, 'auth.required');
    });

    it('answers 404 project.not-found for another Pilote’s Projet, or an id that is not one', async () => {
      const bob = await pilot(9100002, 'bob');

      await expectEnvelope(await getProcess(bob), 404, 'project.not-found');
      await expectEnvelope(await getProcess(alice, newId()), 404, 'project.not-found');
      await expectEnvelope(await getProcess(alice, 'nope'), 404, 'project.not-found');
    });
  });

  describe('PUT /api/projects/:id/process/draft', () => {
    it('creates the draft at revision 1, then 2, each with its process.upserted in its transaction; a third save at revision 1 is 409', async () => {
      const before = (await eventsOf(alice)).length;

      const first = await saved(await save(alice, { revision: 0 }));
      expect(first.draft).toMatchObject({ definition: PROCESS_CREWDECK, revision: 1, baseVersion: 1 });
      expect(first.active?.number).toBe(1);
      const second = await saved(await save(alice, { revision: 1 }));
      expect(second.draft?.revision).toBe(2);

      const stale = await expectEnvelope(await save(alice, { revision: 1 }), 409, 'process.draft-stale');
      expect(stale.message).toBe('Le brouillon a changé dans un autre onglet : recharge-le avant de continuer.');

      const events = (await eventsOf(alice)).slice(before);
      expect(events.map((event) => event.type)).toEqual(['process.upserted', 'process.upserted']);
      expect(events.map((event) => zProjectProcess.parse(event.payload))).toEqual([first, second]);
      expect(await saved(await getProcess(alice))).toEqual(second);
      expect((await state(alice)).processes).toEqual([second]);
    });

    it('answers 409 process.draft-stale for a baseVersion other than the active one, and saves nothing', async () => {
      await expectEnvelope(await save(alice, { baseVersion: 0 }), 409, 'process.draft-stale');
      await expectEnvelope(await save(alice, { baseVersion: 2 }), 409, 'process.draft-stale');
      expect(await sql('SELECT id FROM process_drafts')).toEqual([]);
    });

    it('saves one draft when two tabs save the same revision at once: the other gets 409', async () => {
      const responses = await Promise.all([save(alice, { revision: 0 }), save(alice, { revision: 0 })]);

      expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
      expect(await sql('SELECT revision FROM process_drafts')).toEqual([{ revision: 1 }]);
    });

    it.each(REFUSED)('answers 422 process.invalid for %s, fields naming each target with its label, and saves nothing', async (name) => {
      const { definition, refusals } = fixture(name);
      const before = (await eventsOf(alice)).length;

      const envelope = await expectEnvelope(await save(alice, { definition, sealed: definition.commands.length > 0 ? SEALED : null }), 422, 'process.invalid');

      expect(envelope.message).toBe('Ce Process ne peut pas être dessiné ainsi.');
      const expected: Record<string, string> = {};
      for (const refusal of refusals) expected[refusal.target] ??= refusal.label;
      expect(envelope.fields).toEqual(expected);
      expect(await sql('SELECT id FROM process_drafts')).toEqual([]);
      expect(await eventsOf(alice)).toHaveLength(before);
    });

    it('saves a draft with only Manques: they forbid the activation, not the save', async () => {
      const { definition, refusals } = fixture('input-unfed');
      expect(refusals).toEqual([]);

      expect((await saved(await save(alice, { definition }))).draft?.definition).toEqual(definition);
    });

    it('answers 400 with fields for a definition the schema refuses, or a Commande without its sealed part', async () => {
      const definition = structuredClone(PROCESS_CREWDECK);
      for (const phase of definition.phases.slice(0, 1)) phase.id = 'Pas un id';
      await expectFields(await save(alice, { definition }), ['definition.phases.0.id']);
      await expectFields(await save(alice, { definition: withCommand(), sealed: null }), ['sealed']);
      await expectFields(await save(alice, { revision: -1 }), ['revision']);
    });

    it('stores the sealed part beside a Commande and returns it as sent', async () => {
      const view = await saved(await save(alice, { definition: withCommand(), sealed: SEALED }));

      expect(view.draft?.sealed).toEqual(SEALED);
      expect((await saved(await getProcess(alice))).draft?.sealed).toEqual(SEALED);
      expect(await sql(`SELECT sealed FROM process_drafts`)).toEqual([{ sealed: SEALED }]);
    });

    it('answers 401 without a session, 404 for another Pilote’s Projet', async () => {
      const bob = await pilot(9100002, 'bob');

      await expectEnvelope(await call(undefined, 'PUT', `/api/projects/${projectId}/process/draft`, { definition: PROCESS_CREWDECK, sealed: null, revision: 0, baseVersion: 1 }), 401, 'auth.required');
      await expectEnvelope(await save(bob, {}), 404, 'project.not-found');
      expect(await sql('SELECT id FROM process_drafts')).toEqual([]);
      expect((await eventsOf(bob)).map((event) => event.type)).toEqual([]);
    });
  });

  describe('the usage of a Rôle', () => {
    /** « Process Crewdeck » with the Rôle of « Code » replaced by `roleId`. */
    const codedBy = (roleId: string): ProcessDefinition => {
      const definition = structuredClone(PROCESS_CREWDECK);
      for (const step of definition.steps.filter((candidate) => candidate.id === 'st-code')) {
        step.tools = step.tools.map((tool) => (tool.kind === 'role' ? { kind: 'role', roleId } : tool));
      }
      return definition;
    };

    const usage = (tab: Tab, roleId: string): Promise<number> => runInPilotScope(tab.id, () => prisma.scoped.$transaction((tx) => roleUsage(tx, tab.id, roleId)));

    it('counts the Étapes naming a Rôle in each Projet’s active version and its draft, not in older versions nor another Pilote’s', async () => {
      const bob = await pilot(9100002, 'bob');
      expect(await usage(alice, 'code')).toBe(1);
      expect(await usage(alice, 'review')).toBe(3);

      // Version 2 gives « Code » to another Rôle: version 1, no longer active, counts no more.
      await sql(
        `INSERT INTO process_versions (id, pilot_id, project_id, number, definition, activated_at, activated_by) VALUES ($1, $2, $3, 2, $4, now(), 'pilot')`,
        [newId(), alice.id, projectId, JSON.stringify(codedBy('r-a1b2c3d4'))],
      );
      expect(await usage(alice, 'code')).toBe(0);
      expect(await usage(alice, 'r-a1b2c3d4')).toBe(1);

      // The draft, drawn from version 2, gives it back to « code »: counted beside the version.
      await saved(await save(alice, { definition: PROCESS_CREWDECK, baseVersion: 2 }));
      expect(await usage(alice, 'code')).toBe(1);
      expect(await usage(alice, 'r-a1b2c3d4')).toBe(1);
      expect(await usage(alice, 'review')).toBe(6);
      expect(await usage(alice, 'tester')).toBe(0);

      expect(await usage(bob, 'code')).toBe(0);
      expect(await usage(bob, 'review')).toBe(0);
    });
  });
});
