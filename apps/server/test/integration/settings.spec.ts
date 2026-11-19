import { zAccountSettings, zState } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { RolesService } from '../../src/settings/roles.js';
import { SettingsService } from '../../src/settings/settings.service.js';
import { createAiAccounts } from '../../src/testing/runners.js';
import { CLAUDE_SUBSCRIPTION, CODEX_API_KEY } from '../../src/testing/scenarios/engines.js';
import { expectEnvelope, expectFields, startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl });

const sql = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
};

const DEFAULTS = {
  roles: { idea: null, design: null, code: null, review: null },
  customRoles: [],
  notifications: { push: false },
  timeZone: 'Europe/Paris',
};

describe('the Paramètres of the account against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
  });

  afterAll(async () => {
    await sql('TRUNCATE pilots CASCADE');
    await app.close();
  });

  beforeEach(() => sql('TRUNCATE pilots CASCADE'));

  /** A Pilote with a session: their id and the cookie of a tab. */
  const pilot = async (login = 'octocat'): Promise<{ id: string; cookie: string }> => {
    const id = newId();
    await sql(`WITH p AS (INSERT INTO pilots (id, display_name, time_zone) VALUES ($1, $3, 'Europe/Paris') RETURNING id) INSERT INTO pilot_identities (id, pilot_id, provider, subject, login) SELECT gen_random_uuid(), id, 'github', $2::text, $3 FROM p`, [id, Math.floor(Math.random() * 1e9), login]);
    const prisma = app.get(PrismaService);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  /** The Comptes IA of `pilotId` as their Runner last reported them. */
  const accounts = (pilotId: string, engines = [CLAUDE_SUBSCRIPTION, CODEX_API_KEY]) => createAiAccounts(app.get(PrismaService), pilotId, engines);

  const patch = (cookie: string, body: unknown): Promise<Response> =>
    fetch(`${url}/api/settings`, { method: 'PATCH', headers: { cookie, 'content-type': 'application/json', origin: appOrigin(env) }, body: JSON.stringify(body) });

  const events = (pilotId: string) => sql<{ seq: string; type: string; payload: unknown }>(`SELECT seq, type, payload FROM events WHERE pilot_id = $1 ORDER BY seq`, [pilotId]);

  describe('GET /api/settings', () => {
    it('returns the defaults to a Pilote who never changed any, with their time zone', async () => {
      const alice = await pilot('alice');

      const res = await fetch(`${url}/api/settings`, { headers: { cookie: alice.cookie } });

      expect(res.status).toBe(200);
      expect(zAccountSettings.parse(await res.json())).toEqual(DEFAULTS);
    });

    it('answers 401 without a session', async () => {
      await expectEnvelope(await fetch(`${url}/api/settings`), 401, 'auth.required');
    });
  });

  describe('PATCH /api/settings', () => {
    it('changes only the fields given, returns the settings and writes settings.upserted in the same transaction', async () => {
      const alice = await pilot('alice');
      await accounts(alice.id);

      const res = await patch(alice.cookie, { seq: '0', roles: { code: { engine: 'codex', model: 'gpt-5.5' } } });

      expect(res.status).toBe(200);
      const expected = { ...DEFAULTS, roles: { ...DEFAULTS.roles, code: { engine: 'codex', model: 'gpt-5.5' } } };
      expect(zAccountSettings.parse(await res.json())).toEqual(expected);
      expect(await events(alice.id)).toEqual([{ seq: '1', type: 'settings.upserted', payload: expected }]);
      expect(await sql('SELECT seq FROM pilots WHERE id = $1', [alice.id])).toEqual([{ seq: '1' }]);

      const second = await patch(alice.cookie, { seq: '1', notifications: { push: true } });
      const after = { ...expected, notifications: { push: true } };
      expect(await second.json()).toEqual(after);
      expect(await (await fetch(`${url}/api/settings`, { headers: { cookie: alice.cookie } })).json()).toEqual(after);
    });

    it('moves the Pilote’s time zone, with pilot.upserted beside settings.upserted', async () => {
      const alice = await pilot('alice');

      const res = await patch(alice.cookie, { seq: '0', timeZone: 'America/Montreal' });

      expect(await res.json()).toEqual({ ...DEFAULTS, timeZone: 'America/Montreal' });
      expect(await sql('SELECT time_zone FROM pilots WHERE id = $1', [alice.id])).toEqual([{ time_zone: 'America/Montreal' }]);
      expect((await events(alice.id)).map(({ type, payload }) => [type, (payload as { timeZone: string }).timeZone])).toEqual([
        ['pilot.upserted', 'America/Montreal'],
        ['settings.upserted', 'America/Montreal'],
      ]);
      expect(zState.parse(await (await fetch(`${url}/api/state`, { headers: { cookie: alice.cookie } })).json())).toMatchObject({
        pilot: { timeZone: 'America/Montreal' },
        settings: { timeZone: 'America/Montreal' },
      });
    });

    it('answers 400 with its fields on an unknown key or an unknown time zone, and writes nothing', async () => {
      const alice = await pilot('alice');

      await expectFields(await patch(alice.cookie, { seq: '0', theme: 'dark' }), ['theme']);
      // The Étapes optionnelles are no longer a setting of the account (PARAM-3): the Process holds them.
      await expectFields(await patch(alice.cookie, { seq: '0', optionalSteps: { mockups: false } }), ['optionalSteps']);
      await expectFields(await patch(alice.cookie, { seq: '0', roles: { pilot: null } }), ['roles.pilot']);
      await expectFields(await patch(alice.cookie, { seq: '0', roles: { code: { engine: 'codex', model: 'gpt-5', typo: true } } }), ['roles.code.typo']);
      await expectFields(await patch(alice.cookie, { seq: '0', roles: { 'r-zzzzzzzz': { engine: 'codex', model: 'gpt-5.5' } } }), ['roles.r-zzzzzzzz']);
      const fields = await expectFields(await patch(alice.cookie, { seq: '0', timeZone: 'Mars/Olympus' }), ['timeZone']);
      expect(fields).toEqual({ timeZone: 'Fuseau horaire inconnu.' });

      expect(await events(alice.id)).toEqual([]);
      expect(await sql('SELECT time_zone FROM pilots WHERE id = $1', [alice.id])).toEqual([{ time_zone: 'Europe/Paris' }]);
      expect(await sql('SELECT pilot_id FROM account_settings')).toEqual([]);
    });

    it('answers 422 settings.engine-unusable on the field of a model the Runner cannot run, and writes nothing', async () => {
      const alice = await pilot('alice');
      await accounts(alice.id);

      const quota = await expectEnvelope(await patch(alice.cookie, { seq: '0', roles: { review: { engine: 'codex', model: 'gpt-5.5-pro' } } }), 422, 'settings.engine-unusable');
      expect(quota.fields).toEqual({ 'roles.review': 'Ce modèle n’est pas utilisable sur ton Runner.' });
      const unknown = await patch(alice.cookie, { seq: '0', roles: { idea: { engine: 'claude-code', model: 'claude-haiku-5-5' }, code: { engine: 'codex', model: 'gpt-5.5' } } });
      expect((await expectEnvelope(unknown, 422, 'settings.engine-unusable')).fields).toEqual({ 'roles.idea': 'Ce modèle n’est pas utilisable sur ton Runner.' });
      const bob = await pilot('bob');
      await expectEnvelope(await patch(bob.cookie, { seq: '0', roles: { code: { engine: 'codex', model: 'gpt-5.5' } } }), 422, 'settings.engine-unusable');

      expect(await events(alice.id)).toEqual([]);
      expect(await sql('SELECT pilot_id FROM account_settings')).toEqual([]);
    });

    it('sets a default Rôle back to its default with null, whatever the Runner can run', async () => {
      const alice = await pilot('alice');
      await accounts(alice.id);
      await patch(alice.cookie, { seq: '0', roles: { code: { engine: 'codex', model: 'gpt-5.5' } } });
      await sql('DELETE FROM ai_accounts WHERE pilot_id = $1', [alice.id]);

      const res = await patch(alice.cookie, { seq: '1', roles: { code: null } });

      expect(res.status).toBe(200);
      expect(((await res.json()) as { roles: unknown }).roles).toEqual(DEFAULTS.roles);
    });

    it('answers 401 without a session', async () => {
      await expectEnvelope(await patch('', { seq: '0', notifications: { push: true } }), 401, 'auth.required');
    });

    it('changes only the Pilote’s own settings: another one keeps theirs', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');

      await patch(alice.cookie, { seq: '0', notifications: { push: true }, timeZone: 'Asia/Tokyo' });

      expect(await (await fetch(`${url}/api/settings`, { headers: { cookie: bob.cookie } })).json()).toEqual(DEFAULTS);
      expect(await events(bob.id)).toEqual([]);
    });

    it.each([
      ['with a row of settings', true],
      ['before the first row', false],
    ])('keeps both of two concurrent changes to distinct fields, %s', async (_case, existing) => {
      const alice = await pilot('alice');
      await accounts(alice.id);
      if (existing) await patch(alice.cookie, { seq: '0', roles: { idea: { engine: 'codex', model: 'gpt-5.5' } } });

      // A transaction holds the Pilote's row so that the two PATCHes overlap.
      const holder = new pg.Client({ connectionString: databaseUrl });
      await holder.connect();
      let first: Promise<Response>;
      let second: Promise<Response>;
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT id FROM pilots WHERE id = $1 FOR UPDATE', [alice.id]);
        first = patch(alice.cookie, { seq: '1', roles: { code: { engine: 'codex', model: 'gpt-5.5' } } });
        second = patch(alice.cookie, { seq: '1', notifications: { push: true } });
        await expect
          .poll(async () => (await sql<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`))[0]?.n, { timeout: 5000 })
          .toBe(2);
      } finally {
        await holder.query('COMMIT');
        await holder.end();
      }
      expect((await first).status).toBe(200);
      expect((await second).status).toBe(200);

      expect(await (await fetch(`${url}/api/settings`, { headers: { cookie: alice.cookie } })).json()).toEqual({
        ...DEFAULTS,
        roles: { ...DEFAULTS.roles, code: { engine: 'codex', model: 'gpt-5.5' }, idea: existing ? { engine: 'codex', model: 'gpt-5.5' } : null },
        notifications: { push: true },
      });
    });
  });

  it('has no column of Étapes optionnelles left', async () => {
    expect(await sql(`SELECT column_name FROM information_schema.columns WHERE table_name = 'account_settings' AND column_name = 'optional_steps'`)).toEqual([]);
  });

  describe('SettingsService.effective', () => {
    const effective = (pilotId: string) => runInPilotScope(pilotId, () => app.get(SettingsService).effective(pilotId));
    const CLAUDE = { engine: 'claude-code', model: 'claude-opus-5-5' };
    const CODEX = { engine: 'codex', model: 'gpt-5.5' };

    it('gives Claude Code to Idée, Conception and Code, and Codex to the Review, with both usable and nothing chosen', async () => {
      const alice = await pilot('alice');
      await accounts(alice.id);

      expect((await effective(alice.id)).roles).toEqual({ idea: CLAUDE, design: CLAUDE, code: CLAUDE, review: CODEX });
      // The account's own settings keep the defaults as defaults: never stored.
      expect(((await (await fetch(`${url}/api/settings`, { headers: { cookie: alice.cookie } })).json()) as { roles: unknown }).roles).toEqual(DEFAULTS.roles);
    });

    it('gives Codex to every default Rôle when it is the only Moteur usable', async () => {
      const alice = await pilot('alice');
      await accounts(alice.id, [CODEX_API_KEY]);

      expect((await effective(alice.id)).roles).toEqual({ idea: CODEX, design: CODEX, code: CODEX, review: CODEX });
    });

    it('puts the Review on Claude Code when the Code is on Codex', async () => {
      const alice = await pilot('alice');
      await accounts(alice.id);
      await patch(alice.cookie, { seq: '0', roles: { code: CODEX } });

      expect((await effective(alice.id)).roles).toEqual({ idea: CLAUDE, design: CLAUDE, code: CODEX, review: CLAUDE });
    });

    it('keeps a stored model that reached its quota as stored, and RolesService.check says why it cannot run', async () => {
      const alice = await pilot('alice');
      await accounts(alice.id);
      await patch(alice.cookie, { seq: '0', roles: { review: CODEX } });
      const models = CODEX_API_KEY.models.map((model) => (model.id === 'gpt-5.5' ? { ...model, usable: false, reason: 'quota-reached' } : model));
      await sql(`UPDATE ai_accounts SET models = $2 WHERE pilot_id = $1 AND engine = 'codex'`, [alice.id, JSON.stringify(models)]);

      expect((await effective(alice.id)).roles.review).toEqual(CODEX);
      const checks = await runInPilotScope(alice.id, () => app.get(RolesService).check(alice.id));
      expect(checks).toEqual([
        { roleId: 'idea', ...CLAUDE, usable: true },
        { roleId: 'design', ...CLAUDE, usable: true },
        { roleId: 'code', ...CLAUDE, usable: true },
        { roleId: 'review', ...CODEX, usable: false, reason: 'quota-reached' },
      ]);
      expect(await runInPilotScope(alice.id, () => app.get(RolesService).check(alice.id, { roleIds: ['review', 'r-zzzzzzzz'] }))).toEqual([
        { roleId: 'review', ...CODEX, usable: false, reason: 'quota-reached' },
        { roleId: 'r-zzzzzzzz', engine: null, model: null, usable: false, reason: 'no-engine' },
      ]);
    });

    it('gives a Projet the account’s settings, the defaults without a row', async () => {
      const alice = await pilot('alice');
      const settings = app.get(SettingsService);

      expect(await runInPilotScope(alice.id, () => settings.effective(alice.id))).toEqual(DEFAULTS);
      await patch(alice.cookie, { seq: '0', notifications: { push: true } });
      expect(await runInPilotScope(alice.id, () => settings.effective(alice.id, newId()))).toEqual({ ...DEFAULTS, notifications: { push: true } });
    });
  });
});
