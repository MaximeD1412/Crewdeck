import type { INestApplication } from '@nestjs/common';
import { zMe, zScenarioRun, zState } from '@crewdeck/contracts';
import pg from 'pg';
import { inject } from 'vitest';
import { createApp } from '../../src/app.js';
import { appOrigin, type Env, parseEnv } from '../../src/config/env.js';
import { expectEnvelope, expectFields } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');

const boot = async (nodeEnv: Env['NODE_ENV'], fakes: boolean): Promise<INestApplication> => {
  const env = parseEnv({ CREWDECK_ENV: 'test', NODE_ENV: nodeEnv, DATABASE_URL: databaseUrl, ...(fakes ? { CREWDECK_FAKES: '1' } : {}) });
  const app = await createApp(env, { logs: false });
  await app.listen(0, '127.0.0.1');
  return app;
};

const sql = async <T extends pg.QueryResultRow>(text: string): Promise<T[]> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text)).rows;
  } finally {
    await client.end();
  }
};

/** From the page: its Origin, its session cookie. */
const rename = async (app: INestApplication, body: unknown, cookie?: string): Promise<Response> =>
  fetch(`${await app.getUrl()}/api/testing/pilot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: appOrigin(parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl })), ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

describe('POST /api/testing/pilot against PostgreSQL', () => {
  describe('with CREWDECK_FAKES=1', () => {
    let app: INestApplication;
    let cookie: string;

    beforeAll(async () => {
      app = await boot('development', true);
    });

    beforeEach(async () => {
      const response = await fetch(`${await app.getUrl()}/api/testing/scenarios/composants`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      cookie = zScenarioRun.parse(await response.json()).sessionCookie ?? '';
    });

    afterAll(async () => {
      // The files share the run's database: the scenario's Pilote does not stay for the next.
      await fetch(`${await app.getUrl()}/api/testing/scenarios/blank`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      await app.close();
    });

    it('renames the Pilote signed in and writes its pilot.upserted event: the snapshot follows, its seq moved on', async () => {
      const state = async () => zState.parse(await (await fetch(`${await app.getUrl()}/api/state`, { headers: { cookie } })).json());
      const before = await state();

      const response = await rename(app, { login: 'renamed' }, cookie);

      expect(response.status).toBe(200);
      expect(zMe.parse(await response.json())).toMatchObject({ login: 'renamed', timeZone: 'Europe/Paris' });
      const after = await state();
      expect(after).toMatchObject({ seq: before.seq + 1, pilot: { login: 'renamed' } });
      expect(await sql<{ type: string; login: string }>(`SELECT type, payload->>'login' AS login FROM events`)).toEqual([
        { type: 'pilot.upserted', login: 'renamed' },
      ]);
    });

    it('gives 401 auth.required without a session', async () => {
      await expectEnvelope(await rename(app, { login: 'renamed' }), 401, 'auth.required');
    });

    it('gives 400 validation.invalid for an empty login', async () => {
      await expectFields(await rename(app, { login: '' }, cookie), ['login']);
    });
  });

  it('gives 404 on a server booted without CREWDECK_FAKES (production)', async () => {
    const app = await boot('production', false);
    try {
      expect((await rename(app, { login: 'renamed' })).status).toBe(404);
    } finally {
      await app.close();
    }
  });
});
