import type { INestApplication } from '@nestjs/common';
import { zDecision, zScenarioRun, zState } from '@crewdeck/contracts';
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

const RAISE = {
  kind: 'ticket-blocked',
  projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a01',
  projectName: 'Crewdeck',
  subjectType: 'ticket',
  subjectId: '42',
  label: '#42 Connexion GitHub',
  metaParts: ['Code'],
  tone: 'halt',
  link: '/boucle?ticket=42',
  params: { number: 42 },
};

/** From the page: its Origin, its session cookie. */
const post = async (app: INestApplication, path: string, body: unknown, cookie?: string): Promise<Response> =>
  fetch(`${await app.getUrl()}/api/testing/decisions${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: appOrigin(parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl })), ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

describe('POST /api/testing/decisions against PostgreSQL', () => {
  describe('with CREWDECK_FAKES=1', () => {
    let app: INestApplication;
    let cookie: string;
    const state = async () => zState.parse(await (await fetch(`${await app.getUrl()}/api/state`, { headers: { cookie } })).json());

    beforeAll(async () => {
      app = await boot('development', true);
    });

    beforeEach(async () => {
      const response = await fetch(`${await app.getUrl()}/api/testing/scenarios/a-toi-vide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      cookie = zScenarioRun.parse(await response.json()).sessionCookie ?? '';
    });

    afterAll(async () => {
      // The files share the run's database: the scenario's Pilote does not stay for the next.
      await fetch(`${await app.getUrl()}/api/testing/scenarios/blank`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      await app.close();
    });

    it('raises a Décision for the Pilote signed in, with its decision.upserted; resolve removes it, with its decision.removed', async () => {
      const raised = await post(app, '', RAISE, cookie);
      expect(raised.status).toBe(200);
      const decision = zDecision.parse(await raised.json());
      expect(decision).toMatchObject({ ...RAISE, state: 'open' });
      expect((await state()).decisions).toEqual([decision]);

      const resolved = await post(app, '/resolve', { kind: 'ticket-blocked', subjectId: '42', outcome: 'answered' }, cookie);
      expect(resolved.status).toBe(204);
      expect((await state()).decisions).toEqual([]);
      // The scenario's Runner connects too: only the Décisions' events here.
      expect(await sql<{ type: string }>(`SELECT type FROM events WHERE type LIKE 'decision.%' ORDER BY seq`)).toEqual([{ type: 'decision.upserted' }, { type: 'decision.removed' }]);
    });

    it('gives 401 auth.required without a session', async () => {
      await expectEnvelope(await post(app, '', RAISE), 401, 'auth.required');
      await expectEnvelope(await post(app, '/resolve', { kind: 'ticket-blocked', subjectId: '42', outcome: 'answered' }), 401, 'auth.required');
    });

    it('gives 400 validation.invalid for a Décision the contracts refuse', async () => {
      await expectFields(await post(app, '', { ...RAISE, label: '' }, cookie), ['label']);
      await expectFields(await post(app, '/resolve', { kind: 'nope', subjectId: '42', outcome: 'answered' }, cookie), ['kind']);
    });
  });

  it('gives 404 on a server booted without CREWDECK_FAKES (production)', async () => {
    const app = await boot('production', false);
    try {
      expect((await post(app, '', RAISE)).status).toBe(404);
    } finally {
      await app.close();
    }
  });
});
