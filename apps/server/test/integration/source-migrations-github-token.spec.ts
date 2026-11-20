import { SOURCE_MIGRATION_TOKEN_PERMISSIONS, zSourceMigrationGithubToken } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
import { expectEnvelope, startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl, CREWDECK_FAKES: '1', CREWDECK_COMMIT: 'abc1234' });

const INSTALLATION_ID = 61000002;

const sql = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
};

describe('POST /api/runner/source-migrations/:id/github-token against PostgreSQL (SOURCE-8)', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let fakes: Fakes;
  /** The app's log lines. */
  const logs: string[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp(env, { logs: { write: (line: string) => logs.push(line) } }));
    prisma = app.get(PrismaService);
    fakes = app.get<Fakes>(FAKES);
  });

  afterAll(async () => {
    await sql('TRUNCATE pilots CASCADE');
    await app.close();
  });

  beforeEach(async () => {
    await sql('TRUNCATE pilots CASCADE');
    fakes.github.reset();
    fakes.github.seedInstallation(INSTALLATION_ID);
    logs.length = 0;
  });

  /** A Pilote and the token of its linked Runner. */
  const pilot = async (): Promise<{ id: string; token: string }> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, display_name, time_zone, getting_started_step) VALUES ($1, 'Octo', 'Europe/Paris', 'done')`, [id]);
    const { token } = await createLinkedRunner(prisma, id);
    return { id, token };
  };

  /** A Projet of `pilotId`: `acme/shop` (GitHub id `githubRepoId`) reached through INSTALLATION_ID, or a Local one. */
  const project = async (pilotId: string, kind: 'github' | 'local' | 'access-lost' = 'github', githubRepoId = 4242): Promise<string> => {
    const id = newId();
    if (kind === 'local') {
      await sql(
        `INSERT INTO projects (id, pilot_id, name_sealed, folder_state, release_branch, integration_branch, has_code, inventory_state)
         VALUES ($1, $2, '{"v":1}'::jsonb, 'present', 'main', 'develop', true, 'not-needed')`,
        [id, pilotId],
      );
      return id;
    }
    const repositoryId = newId();
    await sql(
      `INSERT INTO repositories (id, pilot_id, installation_id, github_id, owner, name, full_name, private, default_branch, has_code, updated_at)
       VALUES ($1, $2, $3, $4, 'acme', 'shop', 'acme/shop', true, 'main', true, now())`,
      [repositoryId, pilotId, INSTALLATION_ID, githubRepoId],
    );
    await sql(
      `INSERT INTO projects (id, pilot_id, repository_id, github_repo_id, owner, name, full_name, display_name, release_branch, integration_branch, has_code, inventory_state, access_lost)
       VALUES ($1, $2, $3, $4, 'acme', 'shop', 'acme/shop', 'shop', 'main', 'develop', true, 'not-needed', $5)`,
      [id, pilotId, repositoryId, githubRepoId, kind === 'access-lost'],
    );
    return id;
  };

  type State = 'draining' | 'copying' | 'verifying' | 'switched' | 'done' | 'failed';
  const migration = async (pilotId: string, projectId: string, state: State = 'copying'): Promise<string> => {
    const id = newId();
    await sql(
      `INSERT INTO source_migrations (id, pilot_id, project_id, "group", "from", "to", state, waiting_items, created_at) VALUES ($1, $2, $3, 'ticket', 'local', 'github', $4, '[]', now())`,
      [id, pilotId, projectId, state],
    );
    return id;
  };

  const ask = (id: string, token?: string, cookie?: string): Promise<Response> =>
    fetch(`${url}/api/runner/source-migrations/${id}/github-token`, {
      method: 'POST',
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie, origin: appOrigin(env) } : {}) },
    });

  it('gives a token of the Projet’s repository only, issues: write, while copying, verifying or switched, never stored nor logged', async () => {
    const alice = await pilot();
    const projectId = await project(alice.id, 'github', 4242);
    const id = await migration(alice.id, projectId, 'copying');

    const res = await ask(id, alice.token);

    expect(res.status).toBe(200);
    const body = zSourceMigrationGithubToken.parse(await res.json());
    expect(body.token).toMatch(/^ghs_fake_/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
    expect(fakes.github.calls).toEqual([{ method: 'installationToken', args: [INSTALLATION_ID, { repositoryIds: [4242], permissions: { issues: 'write' } }] }]);
    expect(SOURCE_MIGRATION_TOKEN_PERMISSIONS).toEqual({ issues: 'write' });
    await vi.waitFor(() => expect(logs.some((line) => line.includes('github-token'))).toBe(true));
    expect(logs.join('\n')).not.toContain(body.token);
    const dump = await sql<{ found: boolean }>(`SELECT EXISTS (SELECT 1 FROM source_migrations m WHERE m::text LIKE '%' || $1 || '%') AS found`, [body.token]);
    expect(dump[0]?.found).toBe(false);

    for (const state of ['verifying', 'switched'] as const) {
      await sql('UPDATE source_migrations SET state = $2 WHERE id = $1', [id, state]);
      expect((await ask(id, alice.token)).status).toBe(200);
    }
  });

  it('answers 422 source-migration.not-running for a migration not running or without a repository, 404 for another Pilote’s or no id', async () => {
    const alice = await pilot();
    const bob = await pilot();
    const projectId = await project(alice.id);
    const theirs = await migration(bob.id, await project(bob.id, 'github', 4343));

    for (const state of ['draining', 'done', 'failed'] as const) {
      await expectEnvelope(await ask(await migration(alice.id, projectId, state), alice.token), 422, 'source-migration.not-running');
    }
    await expectEnvelope(await ask(await migration(alice.id, await project(alice.id, 'local')), alice.token), 422, 'source-migration.not-running');
    await expectEnvelope(await ask(await migration(alice.id, await project(alice.id, 'access-lost', 4444)), alice.token), 422, 'source-migration.not-running');
    await expectEnvelope(await ask(theirs, alice.token), 404, 'source-migration.not-found');
    await expectEnvelope(await ask('shop', alice.token), 404, 'source-migration.not-found');
    await expectEnvelope(await ask(newId(), alice.token), 404, 'source-migration.not-found');
    expect(fakes.github.calls).toEqual([]);
  });

  it('answers 401 runner.token-invalid without a Runner token, with a bad one, or with a page’s cookie only', async () => {
    const alice = await pilot();
    const id = await migration(alice.id, await project(alice.id));

    await expectEnvelope(await ask(id), 401, 'runner.token-invalid');
    await expectEnvelope(await ask(id, 'not-a-runner-token'), 401, 'runner.token-invalid');
    await expectEnvelope(await ask(id, undefined, 'crewdeck_session=whatever'), 401, 'runner.token-invalid');
    expect(fakes.github.calls).toEqual([]);
  });
});
