import { CUSTOM_ROLES_MAX, zAccountSettings } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { registerRoleUsage } from '../../src/settings/role-usage.js';
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

const REVUE_CODEX = { name: 'Revue Codex', engine: 'codex', model: 'gpt-5.5' } as const;

describe('the Rôles the Pilote adds against PostgreSQL', () => {
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

  /** A Pilote with a session, both Comptes IA connected unless `engines` says otherwise. */
  const pilot = async (login = 'octocat', engines = [CLAUDE_SUBSCRIPTION, CODEX_API_KEY]): Promise<{ id: string; cookie: string }> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone) VALUES ($1, $2, $3, 'Europe/Paris')`, [id, Math.floor(Math.random() * 1e9), login]);
    const prisma = app.get(PrismaService);
    await createAiAccounts(prisma, id, engines);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  const send = (method: string, path: string, cookie: string, body?: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method,
      headers: { cookie, 'content-type': 'application/json', origin: appOrigin(env) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const create = (cookie: string, body: unknown) => send('POST', '/api/roles', cookie, { seq: '0', ...(body as object) });
  const remove = (cookie: string, id: string) => send('DELETE', `/api/roles/${id}`, cookie, { seq: '0' });
  const settings = async (cookie: string) => zAccountSettings.parse(await (await fetch(`${url}/api/settings`, { headers: { cookie } })).json());

  const events = (pilotId: string) => sql<{ seq: string; type: string; payload: unknown }>(`SELECT seq, type, payload FROM events WHERE pilot_id = $1 ORDER BY seq`, [pilotId]);

  describe('POST /api/roles', () => {
    it('adds the Rôle on its Moteur and model under an r- id, with one settings.upserted in the same transaction', async () => {
      const alice = await pilot('alice');

      const res = await create(alice.cookie, { ...REVUE_CODEX, name: '  Revue Codex ' });

      expect(res.status).toBe(201);
      const body = zAccountSettings.parse(await res.json());
      expect(body.customRoles).toEqual([{ id: expect.stringMatching(/^r-[a-z0-9]{8}$/), name: 'Revue Codex', createdAt: expect.any(String) }]);
      const id = body.customRoles[0]!.id;
      expect(body.roles).toEqual({ idea: null, design: null, code: null, review: null, [id]: { engine: 'codex', model: 'gpt-5.5' } });
      expect(await events(alice.id)).toEqual([{ seq: '1', type: 'settings.upserted', payload: body }]);
      expect(await settings(alice.cookie)).toEqual(body);
      const effective = await runInPilotScope(alice.id, () => app.get(SettingsService).effective(alice.id));
      expect(effective.roles[id]).toEqual({ engine: 'codex', model: 'gpt-5.5' });
      expect(effective.customRoles).toEqual(body.customRoles);
    });

    it('lists the Rôles by creation', async () => {
      const alice = await pilot('alice');
      await create(alice.cookie, REVUE_CODEX);
      await create(alice.cookie, { name: 'Revue Opus', engine: 'claude-code', model: 'claude-opus-5-5' });

      expect((await settings(alice.cookie)).customRoles.map((role) => role.name)).toEqual(['Revue Codex', 'Revue Opus']);
    });

    it('answers 409 roles.name-taken on its name for a name taken, whatever its case, a default Rôle’s included', async () => {
      const alice = await pilot('alice');
      await create(alice.cookie, REVUE_CODEX);

      for (const name of ['revue codex', 'Review', 'IDÉE', 'conception', ' Code ']) {
        const envelope = await expectEnvelope(await create(alice.cookie, { ...REVUE_CODEX, name }), 409, 'roles.name-taken');
        expect(envelope).toEqual({ status: 409, code: 'roles.name-taken', message: 'Un Rôle porte déjà ce nom.', fields: { name: 'Un Rôle porte déjà ce nom.' } });
      }
      expect((await settings(alice.cookie)).customRoles).toHaveLength(1);
    });

    it('lets another Pilote take a name one already has', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      await create(alice.cookie, REVUE_CODEX);

      expect((await create(bob.cookie, REVUE_CODEX)).status).toBe(201);
    });

    it('answers 422 roles.too-many past 20 Rôles', async () => {
      const alice = await pilot('alice');
      for (let n = 1; n <= CUSTOM_ROLES_MAX; n++) expect((await create(alice.cookie, { ...REVUE_CODEX, name: `Revue ${n}` })).status).toBe(201);

      const envelope = await expectEnvelope(await create(alice.cookie, { ...REVUE_CODEX, name: 'Revue 21' }), 422, 'roles.too-many');
      expect(envelope.message).toBe('20 Rôles au plus.');
      expect((await settings(alice.cookie)).customRoles).toHaveLength(CUSTOM_ROLES_MAX);
    });

    it('answers 422 settings.engine-unusable for a model the Runner cannot run', async () => {
      const alice = await pilot('alice', [CODEX_API_KEY]);

      for (const choice of [
        { engine: 'codex', model: 'gpt-5.5-pro' },
        { engine: 'claude-code', model: 'claude-opus-5-5' },
        { engine: 'codex', model: 'gpt-4' },
      ]) {
        const envelope = await expectEnvelope(await create(alice.cookie, { name: 'Revue', ...choice }), 422, 'settings.engine-unusable');
        expect(envelope.fields).toEqual({ model: 'Ce modèle n’est pas utilisable sur ton Runner.' });
      }
      expect(await events(alice.id)).toEqual([]);
    });

    it('answers 400 with its fields on a body that is not a Rôle', async () => {
      const alice = await pilot('alice');

      await expectFields(await create(alice.cookie, { ...REVUE_CODEX, name: '   ' }), ['name']);
      await expectFields(await create(alice.cookie, { ...REVUE_CODEX, name: 'x'.repeat(41) }), ['name']);
      await expectFields(await create(alice.cookie, { ...REVUE_CODEX, engine: 'gemini' }), ['engine']);
      await expectFields(await create(alice.cookie, { ...REVUE_CODEX, id: 'r-a1b2c3d4' }), ['id']);
      expect(await events(alice.id)).toEqual([]);
    });

    it('answers 401 without a session', async () => {
      await expectEnvelope(await create('', REVUE_CODEX), 401, 'auth.required');
    });
  });

  describe('PATCH /api/settings on a Rôle the Pilote added', () => {
    const patch = (cookie: string, body: unknown) => send('PATCH', '/api/settings', cookie, { seq: '0', ...(body as object) });

    it('changes its model, kept in its own row', async () => {
      const alice = await pilot('alice');
      const id = (zAccountSettings.parse(await (await create(alice.cookie, REVUE_CODEX)).json())).customRoles[0]!.id;

      const res = await patch(alice.cookie, { roles: { [id]: { engine: 'claude-code', model: 'claude-sonnet-5-5' } } });

      expect(res.status).toBe(200);
      expect((await settings(alice.cookie)).roles[id]).toEqual({ engine: 'claude-code', model: 'claude-sonnet-5-5' });
      expect(await sql('SELECT engine::text, model FROM custom_roles WHERE id = $1', [id])).toEqual([{ engine: 'claude-code', model: 'claude-sonnet-5-5' }]);
      expect(await sql('SELECT roles FROM account_settings WHERE pilot_id = $1', [alice.id])).toEqual([{ roles: { idea: null, design: null, code: null, review: null } }]);
    });

    it('answers 422 settings.role-choice-required for null: a Rôle the Pilote added always has its model', async () => {
      const alice = await pilot('alice');
      const id = (zAccountSettings.parse(await (await create(alice.cookie, REVUE_CODEX)).json())).customRoles[0]!.id;

      const envelope = await expectEnvelope(await patch(alice.cookie, { roles: { [id]: null } }), 422, 'settings.role-choice-required');
      expect(envelope.message).toBe('Un Rôle que tu as ajouté a toujours son modèle.');
      expect(envelope.fields).toEqual({ [`roles.${id}`]: 'Un Rôle que tu as ajouté a toujours son modèle.' });
      expect((await settings(alice.cookie)).roles[id]).toEqual({ engine: 'codex', model: 'gpt-5.5' });
    });

    it('answers 400 on the field of another Pilote’s Rôle', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const id = (zAccountSettings.parse(await (await create(alice.cookie, REVUE_CODEX)).json())).customRoles[0]!.id;

      await expectFields(await patch(bob.cookie, { roles: { [id]: { engine: 'codex', model: 'gpt-5.5' } } }), [`roles.${id}`]);
    });
  });

  describe('DELETE /api/roles/:id', () => {
    it('removes the Rôle, with one settings.upserted, and its id never comes back', async () => {
      const alice = await pilot('alice');
      const id = (zAccountSettings.parse(await (await create(alice.cookie, REVUE_CODEX)).json())).customRoles[0]!.id;

      const res = await remove(alice.cookie, id);

      expect(res.status).toBe(200);
      const body = zAccountSettings.parse(await res.json());
      expect(body.customRoles).toEqual([]);
      expect(body.roles).toEqual({ idea: null, design: null, code: null, review: null });
      expect((await events(alice.id)).map(({ type, payload }) => [type, payload])).toEqual([
        ['settings.upserted', expect.anything()],
        ['settings.upserted', body],
      ]);
      expect(await settings(alice.cookie)).toEqual(body);
      await expectEnvelope(await remove(alice.cookie, id), 404, 'roles.not-found');
    });

    it('answers 422 roles.default for a default Rôle', async () => {
      const alice = await pilot('alice');

      for (const role of ['idea', 'design', 'code', 'review']) {
        const envelope = await expectEnvelope(await remove(alice.cookie, role), 422, 'roles.default');
        expect(envelope.message).toBe('Les Rôles par défaut ne se retirent pas.');
      }
    });

    it('answers 404 roles.not-found for another Pilote’s Rôle or an unknown one, and removes nothing', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const id = (zAccountSettings.parse(await (await create(alice.cookie, REVUE_CODEX)).json())).customRoles[0]!.id;

      await expectEnvelope(await remove(bob.cookie, id), 404, 'roles.not-found');
      await expectEnvelope(await remove(bob.cookie, 'r-zzzzzzzz'), 404, 'roles.not-found');
      await expectEnvelope(await remove(bob.cookie, 'tester'), 404, 'roles.not-found');
      expect((await settings(alice.cookie)).customRoles).toHaveLength(1);
      expect(await events(bob.id)).toEqual([]);
    });

    it('answers 409 roles.in-use while a RoleUsage provider counts an Étape naming it', async () => {
      const alice = await pilot('alice');
      const id = (zAccountSettings.parse(await (await create(alice.cookie, REVUE_CODEX)).json())).customRoles[0]!.id;
      const unregister = registerRoleUsage(async (_tx, pilotId, roleId) => (pilotId === alice.id && roleId === id ? 2 : 0));
      try {
        const envelope = await expectEnvelope(await remove(alice.cookie, id), 409, 'roles.in-use');
        expect(envelope.message).toBe('Des Étapes de tes Projets utilisent ce Rôle : change-les d’abord.');
        expect((await settings(alice.cookie)).customRoles).toHaveLength(1);
      } finally {
        unregister();
      }
      expect((await remove(alice.cookie, id)).status).toBe(200);
    });

    it('answers 401 without a session', async () => {
      await expectEnvelope(await remove('', 'r-zzzzzzzz'), 401, 'auth.required');
    });
  });
});
