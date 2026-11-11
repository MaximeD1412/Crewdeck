import type { INestApplication } from '@nestjs/common';
import { type EngineCapabilities, zAiAccountList, zScenarioRun } from '@crewdeck/contracts';
import { inject } from 'vitest';
import { createApp } from '../../src/app.js';
import { type Env, parseEnv } from '../../src/config/env.js';
import { expectEnvelope } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');

const boot = async (nodeEnv: Env['NODE_ENV'], fakes: boolean): Promise<INestApplication> => {
  const env = parseEnv({ CREWDECK_ENV: 'test', NODE_ENV: nodeEnv, DATABASE_URL: databaseUrl, ...(fakes ? { CREWDECK_FAKES: '1' } : {}) });
  const app = await createApp(env, { logs: false });
  await app.listen(0, '127.0.0.1');
  return app;
};

const FEATURES = { interrupt: true, resume: true, questions: true, permissions: true };
const CLAUDE: EngineCapabilities = {
  engine: 'claude-code',
  installed: true,
  version: '2.1.3',
  knownVersion: true,
  account: { kind: 'subscription', state: 'connected' },
  models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', usable: true }],
  features: FEATURES,
};

const run = async (app: INestApplication, name: string) =>
  zScenarioRun.parse(await (await fetch(`${await app.getUrl()}/api/testing/scenarios/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json());

const report = async (app: INestApplication, body: unknown): Promise<Response> =>
  fetch(`${await app.getUrl()}/api/testing/runner/capabilities`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const accounts = async (app: INestApplication, cookie: string) =>
  zAiAccountList.parse(await (await fetch(`${await app.getUrl()}/api/ai-accounts`, { headers: { cookie } })).json()).items;

describe('POST /api/testing/runner/capabilities against PostgreSQL', () => {
  describe('with CREWDECK_FAKES=1', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await boot('development', true);
    });

    afterAll(async () => {
      await run(app, 'blank');
      await app.close();
    });

    it('has the scenario’s fake Runner send them, as a Runner whose Compte IA was just connected', async () => {
      const { sessionCookie } = await run(app, 'demarrage-comptes-ia-aucun');
      expect((await accounts(app, sessionCookie ?? '')).map(({ engine, state }) => ({ engine, state }))).toEqual([
        { engine: 'claude-code', state: 'login-required' },
        { engine: 'codex', state: 'login-required' },
      ]);

      expect((await report(app, { engines: [CLAUDE] })).status).toBe(204);

      await vi.waitFor(async () => expect((await accounts(app, sessionCookie ?? ''))[0]).toMatchObject({ engine: 'claude-code', kind: 'subscription', state: 'connected' }));
    });

    it('answers 409 testing.no-runner while no fake Runner is connected', async () => {
      await run(app, 'blank');

      await expectEnvelope(await report(app, { engines: [CLAUDE] }), 409, 'testing.no-runner');
    });

    it('answers 400 for a body that is not capabilities', async () => {
      await run(app, 'demarrage-comptes-ia-aucun');

      expect((await report(app, { engines: [{ engine: 'gemini' }] })).status).toBe(400);
    });
  });

  it('gives 404 on a server booted without CREWDECK_FAKES (production)', async () => {
    const app = await boot('production', false);
    try {
      expect((await report(app, { engines: [CLAUDE] })).status).toBe(404);
    } finally {
      await app.close();
    }
  });
});
