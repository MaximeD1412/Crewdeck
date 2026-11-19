import { zProject, zProjectSettings, zProjectSettingsUpdated, zState } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { ProjectChanges } from '../../src/projects/project-changes.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { ProjectSettingsService } from '../../src/settings/project-settings.js';
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

const CLAUDE = { engine: 'claude-code', model: 'claude-opus-5-5' } as const;
const CODEX = { engine: 'codex', model: 'gpt-5.5' } as const;
const DEFAULT_ROLES = { idea: CLAUDE, design: CLAUDE, code: CLAUDE, review: CODEX };
const INHERITED = { roles: { idea: 'compte', design: 'compte', code: 'compte', review: 'compte' }, notifications: { push: 'compte' } };
const b64 = (bytes: number, fill = 7): string => Buffer.alloc(bytes, fill).toString('base64url');
/** A sealed item as the page sends it: the server can only keep it, never read it. */
const SEALED = { key: b64(60), ciphertext: b64(48) };

interface EventRow {
  type: string;
  payload: Record<string, unknown>;
}

describe('the Paramètres of a Projet against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await sql('TRUNCATE pilots CASCADE');
    await app.close();
  });

  beforeEach(() => sql('TRUNCATE pilots CASCADE'));

  /** A Pilote with a session and both Comptes IA: their id and the cookie of a tab. */
  const pilot = async (login = 'octocat'): Promise<{ id: string; cookie: string }> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone) VALUES ($1, $2, $3, 'Europe/Paris')`, [id, Math.floor(Math.random() * 1e9), login]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    await createAiAccounts(prisma, id, [CLAUDE_SUBSCRIPTION, CODEX_API_KEY]);
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  /** A Projet the Pilote follows, on `develop` and `main`, its Tickets and its code on GitHub. */
  const project = async (pilotId: string, name = 'site-mairie'): Promise<string> => {
    const id = newId();
    await prisma.unscoped.project.create({
      data: {
        id,
        pilotId,
        repositoryId: newId(),
        githubRepoId: BigInt(Math.floor(Math.random() * 1e9)),
        owner: 'octo-fixture',
        name,
        fullName: `octo-fixture/${name}`,
        displayName: name,
        releaseBranch: 'main',
        integrationBranch: 'develop',
        hasCode: true,
        inventoryState: 'not_needed',
      },
    });
    // Its Sources, as following it writes.
    await prisma.unscoped.artifactSource.createMany({
      data: (['ticket', 'code'] as const).map((group) => ({ id: newId(), pilotId, projectId: id, group, source: 'github' as const, since: new Date() })),
    });
    return id;
  };

  const get = (cookie: string, projectId: string): Promise<Response> => fetch(`${url}/api/projects/${projectId}/settings`, { headers: { cookie } });
  const patch = (cookie: string, projectId: string, body: unknown): Promise<Response> =>
    fetch(`${url}/api/projects/${projectId}/settings`, { method: 'PATCH', headers: { cookie, 'content-type': 'application/json', origin: appOrigin(env) }, body: JSON.stringify(body) });
  const patchAccount = (cookie: string, body: unknown): Promise<Response> =>
    fetch(`${url}/api/settings`, { method: 'PATCH', headers: { cookie, 'content-type': 'application/json', origin: appOrigin(env) }, body: JSON.stringify(body) });
  const events = (pilotId: string) => sql<EventRow>(`SELECT type, payload FROM events WHERE pilot_id = $1 ORDER BY seq`, [pilotId]);

  describe('GET /api/projects/:id/settings', () => {
    it('gives a Projet that changed nothing everything from the account, with its branches, nothing changed', async () => {
      const alice = await pilot('alice');
      const projectId = await project(alice.id);

      const res = await get(alice.cookie, projectId);

      expect(res.status).toBe(200);
      expect(zProjectSettings.parse(await res.json())).toEqual({
        projectId,
        effective: { roles: DEFAULT_ROLES, customRoles: [], notifications: { push: false }, timeZone: 'Europe/Paris' },
        origins: INHERITED,
        changedCount: 0,
        branches: { integration: 'develop', release: 'main' },
        worktreeCommands: null,
      });
    });

    it('answers 401 without a session, 404 for another Pilote’s Projet or an id that is not one', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const projectId = await project(alice.id);

      await expectEnvelope(await get('', projectId), 401, 'auth.required');
      await expectEnvelope(await get(bob.cookie, projectId), 404, 'project.not-found');
      await expectEnvelope(await get(alice.cookie, newId()), 404, 'project.not-found');
      await expectEnvelope(await get(alice.cookie, 'not-an-id'), 404, 'project.not-found');
    });
  });

  describe('PATCH /api/projects/:id/settings', () => {
    it('overrides a Rôle for the Projet only, writes settings.upserted in the same transaction, and SettingsService.effective reads it', async () => {
      const alice = await pilot('alice');
      const projectId = await project(alice.id);
      const other = await project(alice.id, 'tennis-manager');

      const res = await patch(alice.cookie, projectId, { seq: '0', roles: { code: CODEX } });

      expect(res.status).toBe(200);
      const answer = zProjectSettingsUpdated.parse(await res.json());
      const body = zProjectSettings.parse(answer);
      // The Review moves to Claude Code, the other Moteur than the Projet's Code.
      expect(body.effective.roles).toEqual({ idea: CLAUDE, design: CLAUDE, code: CODEX, review: CLAUDE });
      expect(body.origins.roles).toEqual({ ...INHERITED.roles, code: 'projet' });
      expect(body.changedCount).toBe(1);
      expect(await events(alice.id)).toEqual([{ type: 'settings.upserted', payload: { projectSettings: body } }]);
      expect(await sql('SELECT seq FROM pilots WHERE id = $1', [alice.id])).toEqual([{ seq: '1' }]);
      // The seq of its settings.upserted: the page knows the store holds the write once it reaches it.
      expect(answer.seq).toBe(1);

      const settings = app.get(SettingsService);
      expect((await runInPilotScope(alice.id, () => settings.effective(alice.id, projectId))).roles).toEqual(body.effective.roles);
      expect((await runInPilotScope(alice.id, () => settings.effective(alice.id, other))).roles).toEqual(DEFAULT_ROLES);
      expect((await runInPilotScope(alice.id, () => settings.effective(alice.id))).roles).toEqual(DEFAULT_ROLES);
    });

    it('goes back to the account’s Rôle and push with null, and turns push off for the Projet only', async () => {
      const alice = await pilot('alice');
      const projectId = await project(alice.id);
      await patchAccount(alice.cookie, { seq: '0', notifications: { push: true } });

      const off = zProjectSettings.parse(await (await patch(alice.cookie, projectId, { seq: '1', roles: { review: CLAUDE }, notifications: { push: false } })).json());
      expect(off).toMatchObject({ effective: { notifications: { push: false } }, origins: { notifications: { push: 'projet' } }, changedCount: 2 });
      expect((await runInPilotScope(alice.id, () => app.get(SettingsService).effective(alice.id))).notifications.push).toBe(true);

      const back = zProjectSettings.parse(await (await patch(alice.cookie, projectId, { seq: '2', roles: { review: null }, notifications: { push: null } })).json());
      expect(back).toMatchObject({ effective: { roles: DEFAULT_ROLES, notifications: { push: true } }, origins: INHERITED, changedCount: 0 });
      expect(await sql('SELECT roles, notifications_push FROM project_settings WHERE project_id = $1', [projectId])).toEqual([{ roles: {}, notifications_push: null }]);
    });

    it('overrides a Rôle the Pilote added, and forgets the override once the Rôle is removed', async () => {
      const alice = await pilot('alice');
      const projectId = await project(alice.id);
      const created = await fetch(`${url}/api/roles`, {
        method: 'POST',
        headers: { cookie: alice.cookie, 'content-type': 'application/json', origin: appOrigin(env) },
        body: JSON.stringify({ seq: '0', name: 'Revue Codex', engine: 'codex', model: 'gpt-5.5' }),
      });
      expect(created.status).toBe(201);
      const [role] = ((await created.json()) as { customRoles: { id: string }[] }).customRoles;
      const roleId = role?.id ?? '';

      const res = zProjectSettings.parse(await (await patch(alice.cookie, projectId, { seq: '0', roles: { [roleId]: CLAUDE } })).json());
      expect(res.effective.roles[roleId]).toEqual(CLAUDE);
      expect(res.origins.roles[roleId]).toBe('projet');

      const removed = await fetch(`${url}/api/roles/${roleId}`, { method: 'DELETE', headers: { cookie: alice.cookie, origin: appOrigin(env) } });
      expect(removed.ok).toBe(true);
      const after = zProjectSettings.parse(await (await get(alice.cookie, projectId)).json());
      expect(after.effective.roles).not.toHaveProperty(roleId);
      expect(after.changedCount).toBe(0);
    });

    it('changes the branches, with project.upserted in the same transaction and the Runner’s Miroir told', async () => {
      const alice = await pilot('alice');
      const projectId = await project(alice.id);
      const told: string[] = [];
      const off = app.get(ProjectChanges).onChanged((pilotId) => told.push(pilotId));

      try {
        const res = await patch(alice.cookie, projectId, { seq: '0', branches: { integration: 'main-2', release: 'release/2026' } });
        expect(res.status).toBe(200);
        const answer = zProjectSettingsUpdated.parse(await res.json());
        expect(answer.branches).toEqual({ integration: 'main-2', release: 'release/2026' });
        // settings.upserted's seq, after project.upserted's.
        expect(answer.seq).toBe(2);
      } finally {
        off();
      }

      const written = await events(alice.id);
      expect(written.map(({ type }) => type)).toEqual(['project.upserted', 'settings.upserted']);
      expect(zProject.parse(written[0]?.payload)).toMatchObject({ id: projectId, integrationBranch: 'main-2', releaseBranch: 'release/2026' });
      expect(await sql('SELECT integration_branch, release_branch, last_seq FROM projects WHERE id = $1', [projectId])).toEqual([
        { integration_branch: 'main-2', release_branch: 'release/2026', last_seq: '1' },
      ]);
      expect(told).toEqual([alice.id]);
      // Branches are the Projet's own: never counted as changed over the account.
      expect(zProjectSettings.parse(await (await get(alice.cookie, projectId)).json()).changedCount).toBe(0);
    });

    it('answers 400 on the field of a branch git refuses, 422 settings.branches-same when both would be one, and writes nothing', async () => {
      const alice = await pilot('alice');
      const projectId = await project(alice.id);

      const fields = await expectFields(await patch(alice.cookie, projectId, { seq: '0', branches: { integration: 'feat..x' } }), ['branches.integration']);
      expect(fields).toEqual({ 'branches.integration': 'Ce nom de branche n’est pas valide.' });
      const same = await expectEnvelope(await patch(alice.cookie, projectId, { seq: '0', branches: { integration: 'main' } }), 422, 'settings.branches-same');
      expect(same.fields).toEqual({ 'branches.integration': 'La branche d’intégration et la branche de release sont deux branches.' });

      expect(await events(alice.id)).toEqual([]);
      expect(await sql('SELECT integration_branch FROM projects WHERE id = $1', [projectId])).toEqual([{ integration_branch: 'develop' }]);
      expect(await sql('SELECT project_id FROM project_settings')).toEqual([]);
    });

    it('answers 400 on an unknown key or Rôle id, 422 settings.engine-unusable on a model the Runner cannot run, and writes nothing', async () => {
      const alice = await pilot('alice');
      const projectId = await project(alice.id);

      await expectFields(await patch(alice.cookie, projectId, { seq: '0', optionalSteps: { mockups: false } }), ['optionalSteps']);
      await expectFields(await patch(alice.cookie, projectId, { seq: '0', notifications: { email: true } }), ['notifications.email']);
      await expectFields(await patch(alice.cookie, projectId, { seq: '0', roles: { 'r-zzzzzzzz': CODEX } }), ['roles.r-zzzzzzzz']);
      const unusable = await expectEnvelope(await patch(alice.cookie, projectId, { seq: '0', roles: { review: { engine: 'codex', model: 'gpt-5.5-pro' } } }), 422, 'settings.engine-unusable');
      expect(unusable.fields).toEqual({ 'roles.review': 'Ce modèle n’est pas utilisable sur ton Runner.' });

      expect(await events(alice.id)).toEqual([]);
      expect(await sql('SELECT project_id FROM project_settings')).toEqual([]);
    });

    it('answers 401 without a session, 404 for another Pilote’s Projet, and writes nothing for it', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const projectId = await project(alice.id);

      await expectEnvelope(await patch('', projectId, { seq: '0', notifications: { push: false } }), 401, 'auth.required');
      await expectEnvelope(await patch(bob.cookie, projectId, { seq: '0', notifications: { push: false } }), 404, 'project.not-found');
      await expectEnvelope(await patch(bob.cookie, projectId, { seq: '0', branches: { integration: 'x' } }), 404, 'project.not-found');

      expect(await events(bob.id)).toEqual([]);
      expect(await sql('SELECT project_id FROM project_settings')).toEqual([]);
      expect(await sql('SELECT integration_branch FROM projects WHERE id = $1', [projectId])).toEqual([{ integration_branch: 'develop' }]);
    });

    it('keeps the worktree Commandes sealed as the page sent them, removes them with null, and refuses more than 16 KiB', async () => {
      const alice = await pilot('alice');
      const projectId = await project(alice.id);

      const res = zProjectSettings.parse(await (await patch(alice.cookie, projectId, { seq: '0', worktreeCommands: SEALED })).json());
      expect(res.worktreeCommands).toEqual(SEALED);
      expect(await sql('SELECT worktree_commands FROM project_settings WHERE project_id = $1', [projectId])).toEqual([{ worktree_commands: SEALED }]);
      expect(await runInPilotScope(alice.id, () => app.get(ProjectSettingsService).worktreeCommands(projectId))).toEqual(SEALED);
      // A change of another setting keeps them.
      await patch(alice.cookie, projectId, { seq: '1', notifications: { push: false } });
      expect(zProjectSettings.parse(await (await get(alice.cookie, projectId)).json()).worktreeCommands).toEqual(SEALED);

      await expectFields(await patch(alice.cookie, projectId, { seq: '2', worktreeCommands: { key: b64(60), ciphertext: b64(16 * 1024 + 3) } }), ['worktreeCommands.ciphertext']);
      await expectFields(await patch(alice.cookie, projectId, { seq: '2', worktreeCommands: { prepare: 'pnpm install', clean: null } }), [
        'worktreeCommands.key',
        'worktreeCommands.ciphertext',
        'worktreeCommands.prepare',
        'worktreeCommands.clean',
      ]);

      const removed = zProjectSettings.parse(await (await patch(alice.cookie, projectId, { seq: '2', worktreeCommands: null })).json());
      expect(removed.worktreeCommands).toBeNull();
      expect(await sql('SELECT worktree_commands FROM project_settings WHERE project_id = $1', [projectId])).toEqual([{ worktree_commands: null }]);
      expect(JSON.stringify(await sql('SELECT * FROM project_settings'))).not.toContain('pnpm install');
    });
  });

  describe('the account’s changes', () => {
    it('reach each Projet: settings.upserted for each, and GET /api/state gives them in the settings slice', async () => {
      const alice = await pilot('alice');
      const first = await project(alice.id);
      const second = await project(alice.id, 'tennis-manager');
      await patch(alice.cookie, first, { seq: '0', notifications: { push: false } });

      await patchAccount(alice.cookie, { seq: '1', roles: { code: CODEX }, notifications: { push: true } });

      const written = (await events(alice.id)).slice(1);
      expect(written.map(({ type, payload }) => [type, (payload['projectSettings'] as { projectId?: string } | undefined)?.projectId ?? 'compte'])).toEqual([
        ['settings.upserted', 'compte'],
        ['settings.upserted', first],
        ['settings.upserted', second],
      ]);
      const state = zState.parse(await (await fetch(`${url}/api/state`, { headers: { cookie: alice.cookie } })).json());
      expect(state.settings.projects.map((settings) => [settings.projectId, settings.effective.roles.code, settings.effective.notifications.push])).toEqual([
        [first, CODEX, false],
        [second, CODEX, true],
      ]);
      expect(state.settings.projects).toEqual(written.slice(1).map(({ payload }) => payload['projectSettings']));
    });
  });
});
