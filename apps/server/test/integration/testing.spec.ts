import type { INestApplication } from '@nestjs/common';
import { LINK_ATTEMPTS_PER_MINUTE, zScenarioRun } from '@crewdeck/contracts';
import pg from 'pg';
import { inject } from 'vitest';
import { createApp } from '../../src/app.js';
import { type Env, parseEnv } from '../../src/config/env.js';
import { RunnerPresence } from '../../src/runners/runner-presence.service.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
import { ScenariosService } from '../../src/testing/scenarios.service.js';
import { defineScenario } from '../../src/testing/scenarios/define.js';
import { signInPilot } from '../../src/testing/scenarios/sign-in.js';

const databaseUrl = inject('databaseUrl');

const boot = async (nodeEnv: Env['NODE_ENV'], fakes: boolean): Promise<INestApplication> => {
  const env = parseEnv({ CREWDECK_ENV: 'test', NODE_ENV: nodeEnv, DATABASE_URL: databaseUrl, ...(fakes ? { CREWDECK_FAKES: '1' } : {}) });
  const app = await createApp(env, { logs: false });
  await app.listen(0, '127.0.0.1');
  return app;
};

const post = async (app: INestApplication, name: string): Promise<Response> =>
  fetch(`${await app.getUrl()}/api/testing/scenarios/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });

const sql = async <T extends pg.QueryResultRow>(text: string): Promise<T[]> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text)).rows;
  } finally {
    await client.end();
  }
};

describe('POST /api/testing/scenarios/:name against PostgreSQL', () => {
  describe('with CREWDECK_FAKES=1', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await boot('development', true);
      await sql('CREATE TABLE scenario_parent (id serial PRIMARY KEY)');
      await sql('CREATE TABLE scenario_child (id serial PRIMARY KEY, parent_id int REFERENCES scenario_parent (id))');
    });

    afterAll(async () => {
      // The files share the run's database: the scenarios' Pilotes do not stay for the next.
      await post(app, 'blank');
      await sql('DROP TABLE scenario_child, scenario_parent');
      await app.close();
    });

    it('empties every data table, keeps the migrations, and returns the blank scenario', async () => {
      await sql('INSERT INTO scenario_parent DEFAULT VALUES');
      await sql('INSERT INTO scenario_child (parent_id) SELECT id FROM scenario_parent');
      const [migrationsBefore] = await sql<{ count: string }>('SELECT count(*) FROM _prisma_migrations');

      const response = await post(app, 'blank');

      expect(response.status).toBe(200);
      expect(zScenarioRun.parse(await response.json())).toEqual({ name: 'blank', path: '/', sessionCookie: null });
      expect(await sql('SELECT * FROM scenario_parent')).toEqual([]);
      expect(await sql('SELECT * FROM scenario_child')).toEqual([]);
      expect(await sql('SELECT count(*) FROM _prisma_migrations')).toEqual([migrationsBefore]);
    });

    it('restarts the sequences', async () => {
      await sql('INSERT INTO scenario_parent DEFAULT VALUES');

      await post(app, 'blank');
      await sql('INSERT INTO scenario_parent DEFAULT VALUES');

      expect(await sql('SELECT id FROM scenario_parent')).toEqual([{ id: 1 }]);
    });

    it('forgets the link attempts of the scenario before: its binary is not rate limited', async () => {
      const link = () =>
        app.getUrl().then((url) =>
          fetch(`${url}/api/runner/link`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ shortId: 'ZZZZ', machine: 'm', os: 'linux', arch: 'amd64', wsl: false, runnerVersion: '0.0.0', engines: ['claude'] }),
          }),
        );
      for (let attempt = 0; attempt < LINK_ATTEMPTS_PER_MINUTE; attempt++) await link();
      expect((await link()).status).toBe(429);

      await post(app, 'blank');

      expect((await link()).status).toBe(404);
    });

    it('signs a scenario’s Pilote in: its session cookie opens /api/me', async () => {
      const run = zScenarioRun.parse(await (await post(app, 'composants')).json());

      expect(run.sessionCookie).toMatch(/^crewdeck_session=[\w-]{43}$/);
      const me = await fetch(`${await app.getUrl()}/api/me`, { headers: { cookie: run.sessionCookie ?? '' } });
      expect(me.status).toBe(200);
      expect(await me.json()).toMatchObject({ login: 'octocat', timeZone: 'Europe/Paris' });
    });

    it.each([
      ['connexion', '/connexion'],
      ['connexion-erreur', '/connexion?erreur=state-mismatch'],
    ])('opens %s signed out, with the fake GitHub user who signs in at once', async (name, path) => {
      const run = zScenarioRun.parse(await (await post(app, name)).json());
      expect(run).toEqual({ name, path, sessionCookie: null });

      const base = await app.getUrl();
      const start = await fetch(`${base}/api/auth/github/start?timeZone=Europe%2FParis&next=%2Fa-toi`, { redirect: 'manual' });
      const authorize = await fetch(new URL(start.headers.get('location') ?? '', base), { redirect: 'manual' });
      const callback = new URL(authorize.headers.get('location') ?? '');
      const cookie = start.headers.getSetCookie()[0]?.split(';')[0] ?? '';
      const signedIn = await fetch(`${base}${callback.pathname}${callback.search}`, { redirect: 'manual', headers: { cookie } });
      expect(signedIn.headers.get('location')).toBe('/a-toi');
    });

    it('connects the fake Runner of a scenario that links one, « en ligne » until the next scenario', async () => {
      const withRunner = defineScenario({
        name: 'avec-runner',
        path: '/',
        seed: async (ctx) => {
          const seed = await signInPilot(ctx);
          const [pilot] = await ctx.prisma.unscoped.pilot.findMany({ select: { id: true } });
          const { token } = await createLinkedRunner(ctx.prisma, pilot?.id ?? '');
          return { ...seed, runnerToken: token };
        },
      });

      await app.get(ScenariosService).run(withRunner);

      const fakes = app.get<Fakes>(FAKES);
      expect(fakes.runner.connected).toBe(true);
      const [runner] = await sql<{ pilot_id: string; state: string; runner_version: string }>('SELECT pilot_id, state, runner_version FROM runners');
      expect(runner).toMatchObject({ state: 'online', runner_version: 'fake' });
      expect(app.get(RunnerPresence).isOnline(runner?.pilot_id ?? '')).toBe(true);

      await post(app, 'blank');

      expect(fakes.runner.connected).toBe(false);
      await vi.waitFor(() => expect(app.get(RunnerPresence).isOnline(runner?.pilot_id ?? '')).toBe(false));
    });

    it('gives 404 testing.unknown-scenario for an unknown name', async () => {
      const response = await post(app, 'nope');

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ status: 404, code: 'testing.unknown-scenario' });
    });
  });

  it('gives 404 on a server booted without CREWDECK_FAKES (production), and empties nothing', async () => {
    await sql('CREATE TABLE scenario_kept (id serial PRIMARY KEY)');
    await sql('INSERT INTO scenario_kept DEFAULT VALUES');
    const app = await boot('production', false);

    try {
      const response = await post(app, 'blank');

      expect(response.status).toBe(404);
      expect(await sql('SELECT id FROM scenario_kept')).toEqual([{ id: 1 }]);
    } finally {
      await app.close();
      await sql('DROP TABLE scenario_kept');
    }
  });
});
