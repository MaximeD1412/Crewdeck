import type { INestApplication } from '@nestjs/common';
import { zScenarioRun } from '@crewdeck/contracts';
import pg from 'pg';
import { inject } from 'vitest';
import { createApp } from '../../src/app.js';
import { type Env, parseEnv } from '../../src/config/env.js';

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
