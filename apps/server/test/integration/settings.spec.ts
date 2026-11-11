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
import { SettingsService } from '../../src/settings/settings.service.js';
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
  optionalSteps: { mockups: true, 'visual-review': true, 'cross-review': true },
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
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone) VALUES ($1, $2, $3, 'Europe/Paris')`, [id, Math.floor(Math.random() * 1e9), login]);
    const prisma = app.get(PrismaService);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

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

      const res = await patch(alice.cookie, { seq: '0', roles: { code: { engine: 'codex', model: 'gpt-5' } }, optionalSteps: { mockups: false } });

      expect(res.status).toBe(200);
      const expected = { ...DEFAULTS, roles: { ...DEFAULTS.roles, code: { engine: 'codex', model: 'gpt-5' } }, optionalSteps: { ...DEFAULTS.optionalSteps, mockups: false } };
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
      await expectFields(await patch(alice.cookie, { seq: '0', roles: { pilot: null } }), ['roles.pilot']);
      const fields = await expectFields(await patch(alice.cookie, { seq: '0', timeZone: 'Mars/Olympus' }), ['timeZone']);
      expect(fields).toEqual({ timeZone: 'Fuseau horaire inconnu.' });

      expect(await events(alice.id)).toEqual([]);
      expect(await sql('SELECT time_zone FROM pilots WHERE id = $1', [alice.id])).toEqual([{ time_zone: 'Europe/Paris' }]);
      expect(await sql('SELECT pilot_id FROM account_settings')).toEqual([]);
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
  });

  describe('SettingsService.effective', () => {
    it('gives a Projet the account’s settings, the defaults without a row', async () => {
      const alice = await pilot('alice');
      const settings = app.get(SettingsService);

      expect(await runInPilotScope(alice.id, () => settings.effective(alice.id))).toEqual(DEFAULTS);
      await patch(alice.cookie, { seq: '0', optionalSteps: { 'cross-review': false } });
      expect(await runInPilotScope(alice.id, () => settings.effective(alice.id, newId()))).toEqual({ ...DEFAULTS, optionalSteps: { ...DEFAULTS.optionalSteps, 'cross-review': false } });
    });
  });
});
