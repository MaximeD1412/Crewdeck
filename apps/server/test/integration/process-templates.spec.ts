import {
  PROCESS_CREWDECK,
  PROCESS_CREWDECK_NAME,
  type ProcessDefinition,
  type ProcessTemplate,
  processSealAad,
  projectFolderAad,
  projectNameAad,
  type SealedItem,
  templateSealAad,
  zProcessTemplate,
  zProjectList,
  zProjectProcess,
  zState,
} from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { WebhookDispatcher } from '../../src/github/webhooks/dispatcher.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
import { openItem, sealItem } from '../../src/testing/vault.js';
import { deliverWebhook, TEST_WEBHOOK_SECRET, webhookFixture } from '../fakes/github.js';
import { connectRunner, type FakeRunnerClient } from '../fakes/runner.js';
import { authKeysEnv } from '../github-app.js';
import { expectEnvelope, startApp } from '../route-baseline.js';

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

const SENDER_ID = 9100001;
const INSTALLATION_ID = 51000001;
const created = webhookFixture<Record<string, unknown>>('installation.created');
const APP_REPO = { owner: 'octo-fixture', name: 'fixture-app', id: 71000001 };

/** « Process Crewdeck » with one Commande, named by the Étape « Checks ». */
const WITH_COMMAND: ProcessDefinition = (() => {
  const definition = structuredClone(PROCESS_CREWDECK);
  definition.commands.push({ id: 'e2e' });
  return definition;
})();
const COMMANDS = JSON.stringify({ e2e: 'pnpm exec playwright test' });

interface Tab {
  id: string;
  cookie: string;
}

interface EventRow {
  type: string;
  payload: Record<string, unknown>;
  tx: string;
}

describe('the Modèles de process against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let fakes: Fakes;
  let dispatcher: WebhookDispatcher;
  const vaultKey = randomBytes(32);
  const closers: FakeRunnerClient[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    prisma = app.get(PrismaService);
    fakes = app.get<Fakes>(FAKES);
    dispatcher = app.get(WebhookDispatcher);
  });

  const empty = () => sql('TRUNCATE pilots, github_installations, github_deliveries CASCADE');

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((closer) => closer.close()));
  });

  afterAll(async () => {
    await empty();
    await app.close();
  });

  const pilot = async (githubUserId: number, login: string): Promise<Tab> => {
    const id = newId();
    await sql(
      `WITH p AS (INSERT INTO pilots (id, display_name, time_zone, getting_started_step, vault_key_version) VALUES ($1, $3, 'Europe/Paris', 'projects', 1) RETURNING id) INSERT INTO pilot_identities (id, pilot_id, provider, subject, login) SELECT gen_random_uuid(), id, 'github', $2::text, $3 FROM p`,
      [id, githubUserId, login],
    );
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  const call = (tab: Tab | undefined, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method,
      headers: { ...(tab ? { cookie: tab.cookie } : {}), origin: ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const state = async (tab: Tab) => zState.parse(await (await call(tab, 'GET', '/api/state')).json());
  const eventsOf = (tab: Tab): Promise<EventRow[]> => sql<EventRow>('SELECT type, payload, xmin::text AS tx FROM events WHERE pilot_id = $1 ORDER BY seq', [tab.id]);
  const templateEvents = async (tab: Tab): Promise<EventRow[]> => (await eventsOf(tab)).filter((event) => event.type.startsWith('process-template.'));

  /** The Pilote follows the fixture's repository from « Process Crewdeck »: their Projet's id. */
  const follow = async (tab: Tab): Promise<string> => {
    const res = await deliverWebhook(url, { event: 'installation', payload: created });
    expect(res.status).toBe(202);
    await dispatcher.settled();
    const { seq, repositories } = await state(tab);
    const followed = await call(tab, 'POST', '/api/projects', { repositoryIds: repositories.map((repository) => repository.id), templateId: 'process-crewdeck', seq: String(seq) });
    expect(followed.status).toBe(201);
    return zProjectList.parse(await followed.json()).items[0]?.id ?? '';
  };

  /** Version 2 of the Projet: « Process Crewdeck » with a Commande, its text sealed under `process:<projectId>`, as an activation leaves it. */
  const activateWithCommand = async (tab: Tab, projectId: string): Promise<void> => {
    await sql(`INSERT INTO process_versions (id, pilot_id, project_id, number, definition, sealed, activated_at, activated_by) VALUES ($1, $2, $3, 2, $4, $5, now(), 'pilot')`, [
      newId(),
      tab.id,
      projectId,
      JSON.stringify(WITH_COMMAND),
      JSON.stringify(sealItem(vaultKey, COMMANDS, processSealAad(projectId))),
    ]);
  };

  const save = (tab: Tab, input: { id?: string; name?: string; projectId?: string; versionNumber?: number; sealed?: SealedItem | null; replace?: boolean }) =>
    call(tab, 'POST', '/api/process-templates', { id: newId(), name: 'Process web', projectId, versionNumber: 1, sealed: null, replace: false, ...input });
  const template = async (res: Response, status = 201): Promise<ProcessTemplate> => {
    expect(res.status).toBe(status);
    return zProcessTemplate.parse(await res.json());
  };

  let alice: Tab;
  let projectId: string;

  beforeEach(async () => {
    await empty();
    fakes.github.reset();
    fakes.github.seedRepo({ ...APP_REPO, installationId: INSTALLATION_ID, files: { 'README.md': '# App' } });
    alice = await pilot(SENDER_ID, 'octo-fixture');
    projectId = await follow(alice);
  });

  describe('POST /api/process-templates', () => {
    it('saves the active version as a Modèle: 201, its row, its process-template.upserted in its transaction, the processTemplates slice', async () => {
      const id = newId();
      const saved = await template(await save(alice, { id, name: '  Process web  ' }));

      expect(saved).toEqual({ id, name: 'Process web', fromProjectId: projectId, fromVersionNumber: 1, sealed: null, commandCount: 0, createdAt: expect.any(String), updatedAt: saved.createdAt });
      expect(await sql(`SELECT definition, name_key FROM process_templates WHERE id = $1`, [id])).toEqual([{ definition: PROCESS_CREWDECK, name_key: 'process web' }]);
      const events = await templateEvents(alice);
      expect(events.map((event) => [event.type, zProcessTemplate.parse(event.payload)])).toEqual([['process-template.upserted', saved]]);
      expect((await state(alice)).processTemplates).toEqual([saved]);
    });

    it('copies a version with Commandes and the page’s part sealed under template:<id>; its count of Commandes', async () => {
      await activateWithCommand(alice, projectId);
      const id = newId();
      const sealed = sealItem(vaultKey, COMMANDS, templateSealAad(id));

      const saved = await template(await save(alice, { id, versionNumber: 2, sealed }));

      expect(saved).toMatchObject({ fromVersionNumber: 2, sealed, commandCount: 1 });
      expect(openItem(vaultKey, saved.sealed ?? sealed, templateSealAad(id)).toString()).toBe(COMMANDS);
    });

    it('replaces the Modèle of the same name with replace: 200, one row, the new version, a later updatedAt', async () => {
      const id = newId();
      const first = await template(await save(alice, { id, name: 'Process web' }));
      await activateWithCommand(alice, projectId);

      const replaced = await template(await save(alice, { id, name: 'PROCESS WEB', versionNumber: 2, sealed: sealItem(vaultKey, COMMANDS, templateSealAad(id)), replace: true }), 200);

      expect(replaced).toMatchObject({ id, name: 'PROCESS WEB', fromVersionNumber: 2, commandCount: 1, createdAt: first.createdAt });
      expect(Date.parse(replaced.updatedAt)).toBeGreaterThan(Date.parse(first.updatedAt));
      expect(await sql(`SELECT id FROM process_templates`)).toEqual([{ id }]);
      expect((await templateEvents(alice)).map((event) => event.type)).toEqual(['process-template.upserted', 'process-template.upserted']);
    });

    it('refuses a name taken without replace, or with replace but another id: 409 process-template.name-taken, nothing written', async () => {
      const id = newId();
      await template(await save(alice, { id, name: 'Process web' }));

      for (const input of [{ name: 'process web' }, { name: ' Process Web ', replace: true }]) {
        const res = await save(alice, input);
        expect((await expectEnvelope(res, 409, 'process-template.name-taken')).fields).toEqual({ name: 'Un Modèle de process porte déjà ce nom.' });
      }
      expect(await sql(`SELECT id FROM process_templates`)).toEqual([{ id }]);
      expect(await templateEvents(alice)).toHaveLength(1);
    });

    it('refuses « Process Crewdeck » in any case: 422 process-template.name-reserved', async () => {
      const res = await save(alice, { name: ` ${PROCESS_CREWDECK_NAME.toUpperCase()} ` });

      expect((await expectEnvelope(res, 422, 'process-template.name-reserved')).fields).toEqual({ name: 'Ce nom est celui du Modèle de Crewdeck.' });
      expect(await sql(`SELECT id FROM process_templates`)).toEqual([]);
    });

    it('refuses a version that is no longer the active one: 409 process.version-stale', async () => {
      await activateWithCommand(alice, projectId);

      const res = await save(alice, { versionNumber: 1 });

      await expectEnvelope(res, 409, 'process.version-stale');
    });

    it('refuses a sealed part missing for Commandes, or present without one: 422 process-template.sealed-mismatch', async () => {
      const missing = await save(alice, { sealed: sealItem(vaultKey, COMMANDS, templateSealAad(newId())) });
      await expectEnvelope(missing, 422, 'process-template.sealed-mismatch');

      await activateWithCommand(alice, projectId);
      const extra = await save(alice, { versionNumber: 2, sealed: null });
      await expectEnvelope(extra, 422, 'process-template.sealed-mismatch');
    });

    it('refuses an id another Modèle holds (422 process-template.id-taken) and a 51st Modèle (422 process-template.too-many)', async () => {
      const id = newId();
      await template(await save(alice, { id, name: 'Un' }));
      const taken = await save(alice, { id, name: 'Deux' });
      await expectEnvelope(taken, 422, 'process-template.id-taken');

      await sql(
        `INSERT INTO process_templates (id, pilot_id, name, name_key, from_project_id, from_version_number, definition, created_at, updated_at) SELECT gen_random_uuid(), $1, 'M' || n, 'm' || n, $2, 1, '{}', now(), now() FROM generate_series(1, 49) n`,
        [alice.id, projectId],
      );
      const tooMany = await save(alice, { name: 'Cinquante et un' });
      await expectEnvelope(tooMany, 422, 'process-template.too-many');
    });

    it('is a 404 project.not-found for another Pilote’s Projet, a 400 for a body out of its schema, a 401 without session', async () => {
      const bob = await pilot(9100002, 'bob');

      const other = await save(bob, { projectId });
      await expectEnvelope(other, 404, 'project.not-found');
      const invalid = await save(alice, { name: '' });
      await expectEnvelope(invalid, 400, 'validation.invalid');
      expect((await call(undefined, 'POST', '/api/process-templates', {})).status).toBe(401);
    });
  });

  describe('PATCH and DELETE /api/process-templates/:id', () => {
    it('renames a Modèle: 200, its process-template.upserted; 409 for a name another Modèle holds; its own name in another case passes', async () => {
      const web = await template(await save(alice, { name: 'Process web' }));
      await template(await save(alice, { name: 'Process mobile' }));

      const renamed = await template(await call(alice, 'PATCH', `/api/process-templates/${web.id}`, { name: 'Process site' }), 200);
      expect(renamed).toMatchObject({ id: web.id, name: 'Process site', fromProjectId: projectId });
      const last = (await templateEvents(alice)).at(-1);
      expect([last?.type, last?.payload]).toEqual(['process-template.upserted', renamed]);

      const taken = await call(alice, 'PATCH', `/api/process-templates/${web.id}`, { name: 'PROCESS MOBILE' });
      expect((await expectEnvelope(taken, 409, 'process-template.name-taken')).fields).toEqual({ name: 'Un Modèle de process porte déjà ce nom.' });
      expect((await template(await call(alice, 'PATCH', `/api/process-templates/${web.id}`, { name: 'process SITE' }), 200)).name).toBe('process SITE');
      const reserved = await call(alice, 'PATCH', `/api/process-templates/${web.id}`, { name: PROCESS_CREWDECK_NAME });
      expect(reserved.status).toBe(422);
    });

    it('deletes a Modèle: 204, its process-template.removed { id }, gone from the slice; then 404', async () => {
      const web = await template(await save(alice, { name: 'Process web' }));

      expect((await call(alice, 'DELETE', `/api/process-templates/${web.id}`)).status).toBe(204);

      expect((await templateEvents(alice)).map((event) => [event.type, event.payload])).toEqual([
        ['process-template.upserted', web],
        ['process-template.removed', { id: web.id }],
      ]);
      expect((await state(alice)).processTemplates).toEqual([]);
      const again = await call(alice, 'DELETE', `/api/process-templates/${web.id}`);
      await expectEnvelope(again, 404, 'process-template.not-found');
    });

    it('is a 404 process-template.not-found for another Pilote’s Modèle or an id that is not one, renamed or deleted', async () => {
      const web = await template(await save(alice, { name: 'Process web' }));
      const bob = await pilot(9100002, 'bob');

      for (const res of [
        await call(bob, 'PATCH', `/api/process-templates/${web.id}`, { name: 'À moi' }),
        await call(bob, 'DELETE', `/api/process-templates/${web.id}`),
        await call(alice, 'DELETE', '/api/process-templates/pas-un-id'),
      ]) {
        await expectEnvelope(res, 404, 'process-template.not-found');
      }
      expect(await sql(`SELECT name FROM process_templates`)).toEqual([{ name: 'Process web' }]);
    });

    it('keeps the Modèles of a deleted Projet, their fromProjectId null', async () => {
      const web = await template(await save(alice, { name: 'Process web' }));

      await sql('DELETE FROM projects WHERE id = $1', [projectId]);

      expect(await sql(`SELECT id, from_project_id FROM process_templates`)).toEqual([{ id: web.id, from_project_id: null }]);
      expect((await state(alice)).processTemplates).toEqual([{ ...web, fromProjectId: null }]);
    });
  });

  describe('a Projet started from a Modèle', () => {
    /** Alice's Modèle « Process web »: version 2 of her Projet, with its Commande. */
    const savedWithCommand = async (): Promise<ProcessTemplate> => {
      await activateWithCommand(alice, projectId);
      const id = newId();
      return template(await save(alice, { id, name: 'Process web', versionNumber: 2, sealed: sealItem(vaultKey, COMMANDS, templateSealAad(id)) }));
    };

    const online = async (tab: Tab): Promise<void> => {
      const runner = await createLinkedRunner(prisma, tab.id);
      const socket = await connectRunner(url, runner.token);
      closers.push(socket);
      socket.hello({ machine: 'atelier' });
      await socket.expect('hello.accepted');
    };

    const createLocal = (tab: Tab, id: string, templateId: string, templateSealed: SealedItem | null) =>
      call(tab, 'POST', '/api/projects/local', {
        id,
        nameSealed: sealItem(vaultKey, 'Recettes', projectNameAad(id)),
        folderSealed: sealItem(vaultKey, JSON.stringify({ path: '/home/pilote/recettes' }), projectFolderAad(id)),
        vaultKeyVersion: 1,
        hasCode: true,
        releaseBranch: 'main',
        templateId,
        templateSealed,
      });

    const processOf = async (tab: Tab, id: string) => {
      const res = await call(tab, 'GET', `/api/projects/${id}/process`);
      expect(res.status).toBe(200);
      return zProjectProcess.parse(await res.json());
    };

    it('gives a Local Projet the Modèle’s definition and the part the page re-sealed under process:<projectId>; a draft, its Manques on Local', async () => {
      const web = await savedWithCommand();
      await online(alice);
      const id = newId();

      const res = await createLocal(alice, id, web.id, sealItem(vaultKey, COMMANDS, processSealAad(id)));

      expect(res.status).toBe(201);
      // Saved from a Projet on GitHub, its Étapes read GitHub's artefacts: on a Local Projet that is a Manque, so a draft (PROCESS-3).
      const { active, draft } = await processOf(alice, id);
      expect(active).toBeNull();
      expect(draft).toMatchObject({ definition: WITH_COMMAND, baseVersion: 0 });
      expect(openItem(vaultKey, draft?.sealed ?? { key: '', ciphertext: '' }, processSealAad(id)).toString()).toBe(COMMANDS);
      expect(() => openItem(vaultKey, draft?.sealed ?? { key: '', ciphertext: '' }, templateSealAad(web.id))).toThrow();
    });

    it('gets it too when it follows a Dépôt GitHub, with the id the page drew', async () => {
      const web = await savedWithCommand();
      await sql('DELETE FROM projects WHERE id = $1', [projectId]);
      const { seq, repositories } = await state(alice);
      const id = newId();

      const res = await call(alice, 'POST', '/api/projects', {
        repositoryIds: repositories.map((repository) => repository.id),
        templateId: web.id,
        projects: repositories.map((repository) => ({ repositoryId: repository.id, id, templateSealed: sealItem(vaultKey, COMMANDS, processSealAad(id)) })),
        seq: String(seq),
      });

      expect(res.status).toBe(201);
      expect(zProjectList.parse(await res.json()).items.map((project) => project.id)).toEqual([id]);
      const { active, draft } = await processOf(alice, id);
      expect(active).toMatchObject({ number: 1, definition: WITH_COMMAND, activatedBy: 'creation', templateName: 'Process web' });
      expect(draft).toBeNull();
      expect(openItem(vaultKey, active?.sealed ?? { key: '', ciphertext: '' }, processSealAad(id)).toString()).toBe(COMMANDS);
      expect(() => openItem(vaultKey, active?.sealed ?? { key: '', ciphertext: '' }, templateSealAad(web.id))).toThrow();
    });

    it('is a 404 process-template.not-found once the Modèle is gone or is another Pilote’s, a 422 sealed-mismatch without its part; nothing created', async () => {
      const web = await savedWithCommand();
      const bob = await pilot(9100002, 'bob');
      await online(alice);
      await online(bob);

      const mismatch = await createLocal(alice, newId(), web.id, null);
      await expectEnvelope(mismatch, 422, 'process-template.sealed-mismatch');
      const other = newId();
      const foreign = await createLocal(bob, other, web.id, sealItem(vaultKey, COMMANDS, processSealAad(other)));
      await expectEnvelope(foreign, 404, 'process-template.not-found');
      expect((await call(alice, 'DELETE', `/api/process-templates/${web.id}`)).status).toBe(204);
      const gone = newId();
      const deleted = await createLocal(alice, gone, web.id, sealItem(vaultKey, COMMANDS, processSealAad(gone)));
      await expectEnvelope(deleted, 404, 'process-template.not-found');

      expect(await sql(`SELECT id FROM projects`)).toEqual([{ id: projectId }]);
    });

    it('keeps its Process when the Modèle is renamed or deleted afterwards: it is a copy', async () => {
      const web = await savedWithCommand();
      await online(alice);
      const id = newId();
      expect((await createLocal(alice, id, web.id, sealItem(vaultKey, COMMANDS, processSealAad(id)))).status).toBe(201);

      expect((await call(alice, 'PATCH', `/api/process-templates/${web.id}`, { name: 'Autre' })).status).toBe(200);
      expect((await call(alice, 'DELETE', `/api/process-templates/${web.id}`)).status).toBe(204);

      expect((await processOf(alice, id)).draft?.definition).toEqual(WITH_COMMAND);
    });
  });
});
