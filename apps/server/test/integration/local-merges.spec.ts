import { localTextAad, projectFolderAad, projectNameAad, zDecision, zState } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PinoLogger } from 'nestjs-pino';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { LocalMerges, type LocalMergeFinished } from '../../src/process/sources/local-merges.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
import { sealItem } from '../../src/testing/vault.js';
import { connectRunner, type FakeRunnerClient } from '../fakes/runner.js';
import { startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl, CREWDECK_COMMIT: 'abc1234' });
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

const reset = async (): Promise<void> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await sql('TRUNCATE pilots CASCADE');
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== '40P01' || attempt === 5) throw error;
    }
  }
};

/** Every row of every table, as text: what a reader of the database would see. */
const database = async (): Promise<string> => {
  const tables = await sql<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  const dumps = await Promise.all(tables.map(({ tablename }) => sql<{ row: string }>(`SELECT row_to_json(t)::text AS row FROM "${tablename}" t`)));
  return dumps.flat().map(({ row }) => row).join('\n');
};

/** The name of a file the Pilote's uncommitted work touches: never on the server. */
const MARKER = 'MARQUEUR-merge-5b2e';
const SHA = 'a1'.repeat(20);
const SQUASH = 'b2'.repeat(20);

interface Pilot {
  id: string;
  cookie: string;
  token: string;
}

describe('the merges of a Local Projet’s changes of code, against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let merges: LocalMerges;
  const lines: string[] = [];
  const closers: FakeRunnerClient[] = [];
  const removals: (() => void)[] = [];
  const vaultKey = randomBytes(32);

  beforeAll(async () => {
    ({ app, url } = await startApp(env, { logs: { write: (line: string) => lines.push(line) } }));
    prisma = app.get(PrismaService);
    merges = app.get(LocalMerges);
    PinoLogger.root.level = 'debug';
  });

  afterAll(async () => {
    await reset();
    await app.close();
  });

  beforeEach(async () => {
    lines.length = 0;
    await reset();
  });

  afterEach(async () => {
    removals.splice(0).forEach((remove) => remove());
    await Promise.all(closers.splice(0).map((closer) => closer.close()));
  });

  const pilot = async (login: string): Promise<Pilot> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, display_name, time_zone, getting_started_step, vault_key_version) VALUES ($1, $2, 'Europe/Paris', 'projects', 1)`, [id, login]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    const runner = await createLinkedRunner(prisma, id);
    return { id, cookie: `${SESSION_COOKIE}=${token}`, token: runner.token };
  };

  const online = async ({ token }: Pilot): Promise<FakeRunnerClient> => {
    const socket = await connectRunner(url, token);
    closers.push(socket);
    socket.hello({ machine: 'atelier' });
    await socket.expect('hello.accepted');
    return socket;
  };

  const call = (who: Pilot, path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie: who.cookie, origin: ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const state = async (who: Pilot) => zState.parse(await (await call(who, '/api/state')).json());

  const localProject = async (who: Pilot): Promise<string> => {
    const id = newId();
    const res = await call(who, '/api/projects/local', {
      id,
      nameSealed: sealItem(vaultKey, 'Recettes', projectNameAad(id)),
      folderSealed: sealItem(vaultKey, JSON.stringify({ path: '/home/pilote/recettes' }), projectFolderAad(id)),
      vaultKeyVersion: 1,
      hasCode: true,
      releaseBranch: 'trunk',
      templateId: 'process-crewdeck',
    });
    expect(res.status).toBe(201);
    return id;
  };

  const eventually = async (check: () => Promise<void>): Promise<void> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await check();
      } catch (error) {
        if (attempt === 50) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  };

  const result = (runner: FakeRunnerClient, projectId: string, outcome: 'merged' | 'conflict' | 'blocked' | 'stale') =>
    runner.send({ type: 'merge.local.result', projectId, changeNumber: 3, sha: SHA, outcome, ...(outcome === 'merged' ? { mergeSha: SQUASH } : {}) });

  /** The hook's calls, `local-merge.finished`, from now on. */
  const finishedCalls = (): LocalMergeFinished[] => {
    const calls: LocalMergeFinished[] = [];
    removals.push(merges.onFinished(async (_tx, finished) => void calls.push(finished)));
    return calls;
  };

  const decisionsOf = (projectId: string) =>
    sql<{ kind: string; subject_type: string; subject_id: string; state: string; outcome: string | null }>(
      `SELECT kind, subject_type, subject_id, state, outcome FROM decisions WHERE project_id = $1 ORDER BY created_at`,
      [projectId],
    );

  const eventsOf = (who: Pilot) => sql<{ type: string }>(`SELECT type FROM events WHERE pilot_id = $1 AND type LIKE 'decision.%' ORDER BY seq`, [who.id]);

  it('sends merge.local to the Pilote’s Runner, at the judged SHA only; 422 runner.offline without it', async () => {
    const alice = await pilot('alice');
    const runner = await online(alice);
    const projectId = await localProject(alice);
    merges.request(alice.id, { projectId, changeNumber: 3, sha: SHA });
    expect(await runner.expect('merge.local')).toMatchObject({ type: 'merge.local', projectId, changeNumber: 3, sha: SHA });

    await runner.close();
    await eventually(async () =>
      expect(() => merges.request(alice.id, { projectId, changeNumber: 3, sha: SHA })).toThrow(expect.objectContaining({ status: 422, code: 'runner.offline' })),
    );
  });

  it('raises « Merge en attente » once for a blocked merge, resolves it once merged, and tells the caller each result in its transaction', async () => {
    const alice = await pilot('alice');
    const runner = await online(alice);
    const projectId = await localProject(alice);
    const calls = finishedCalls();

    result(runner, projectId, 'blocked');
    result(runner, projectId, 'blocked'); // a retry still blocked
    await eventually(async () => expect(calls).toHaveLength(2));
    expect(await decisionsOf(projectId)).toEqual([{ kind: 'merge.local-blocked', subject_type: 'code-change', subject_id: `${projectId}:3`, state: 'open', outcome: null }]);
    const [open] = (await state(alice)).decisions.map((decision) => zDecision.parse(decision));
    expect(open).toMatchObject({
      kind: 'merge.local-blocked',
      projectId,
      label: 'Merge en attente : tes modifications touchent les mêmes fichiers',
      metaParts: ['Changement #3'],
      tone: 'caution',
      link: `/projets/${projectId}`,
      params: {},
    });

    result(runner, projectId, 'merged');
    await eventually(async () => expect(calls).toHaveLength(3));
    expect(await decisionsOf(projectId)).toEqual([expect.objectContaining({ state: 'resolved', outcome: 'merged' })]);
    expect((await state(alice)).decisions).toEqual([]);
    expect((await eventsOf(alice)).map((event) => event.type)).toEqual(['decision.upserted', 'decision.upserted', 'decision.removed']);
    expect(calls).toEqual([
      { pilotId: alice.id, projectId, changeNumber: 3, sha: SHA, outcome: 'blocked', mergeSha: null },
      { pilotId: alice.id, projectId, changeNumber: 3, sha: SHA, outcome: 'blocked', mergeSha: null },
      { pilotId: alice.id, projectId, changeNumber: 3, sha: SHA, outcome: 'merged', mergeSha: SQUASH },
    ]);
  });

  it('resolves « Merge en attente » with a conflict or a stale head as their outcome', async () => {
    const alice = await pilot('alice');
    const runner = await online(alice);
    const projectId = await localProject(alice);
    const calls = finishedCalls();
    for (const outcome of ['conflict', 'stale'] as const) {
      result(runner, projectId, 'blocked');
      result(runner, projectId, outcome);
    }
    await eventually(async () => expect(calls).toHaveLength(4));
    expect((await decisionsOf(projectId)).map((decision) => [decision.state, decision.outcome])).toEqual([
      ['resolved', 'conflict'],
      ['resolved', 'stale'],
    ]);
  });

  it('rolls the Décision back and closes the socket when the caller’s hook fails, and ignores a result of another Pilote’s Projet', async () => {
    const alice = await pilot('alice');
    const bob = await pilot('bob');
    const runner = await online(alice);
    const projectId = await localProject(alice);
    await online(bob);
    const bobs = await localProject(bob);
    removals.push(
      merges.onFinished(async () => {
        throw new Error('the caller failed');
      }),
    );
    result(runner, projectId, 'blocked');
    await eventually(async () => expect(lines.join('\n')).toContain('local merge result failed'));
    expect(await decisionsOf(projectId)).toEqual([]);
    removals.splice(0).forEach((remove) => remove());

    // The result failed closes the socket: the Runner sends again on its next one.
    await runner.closed();
    const again = await online(alice);
    const calls = finishedCalls();
    result(again, bobs, 'blocked');
    await eventually(async () => expect(lines.join('\n')).toContain('local merge result of an unknown project'));
    expect(calls).toEqual([]);
    expect(await decisionsOf(bobs)).toEqual([]);
  });

  it('never holds a file’s name, neither in the database nor in the logs', async () => {
    const alice = await pilot('alice');
    const runner = await online(alice);
    const projectId = await localProject(alice);
    const calls = finishedCalls();
    // A Runner that would name the files: the protocol refuses it.
    runner.send(JSON.stringify({ type: 'merge.local.result', id: newId(), at: new Date().toISOString(), projectId, changeNumber: 3, sha: SHA, outcome: 'blocked', files: [`src/${MARKER}.ts`] }));
    await runner.expect('error');
    result(runner, projectId, 'blocked');
    await eventually(async () => expect(calls).toHaveLength(1));
    result(runner, projectId, 'merged');
    await eventually(async () => expect(calls).toHaveLength(2));

    expect(await database()).not.toContain(MARKER);
    expect(lines.join('\n')).not.toContain(MARKER);
    expect(lines.join('\n')).toContain('local.merge.result');
  });

  it('writes the new head of a change whose branch a Session pushed (local.changed)', async () => {
    const alice = await pilot('alice');
    const runner = await online(alice);
    const projectId = await localProject(alice);
    const change = (headSha: string, observedAt: string) => ({
      kind: 'change' as const,
      number: 3,
      ticketNumber: null,
      titleSealed: sealItem(vaultKey, 'Le x', localTextAad(projectId, 'change:3:title')),
      state: 'open',
      baseRef: 'develop',
      headSha,
      mergeSha: null,
      createdAt: '2026-11-20T08:00:00.000Z',
      updatedAt: observedAt,
      mergedAt: null,
      closedAt: null,
      observedAt,
    });
    const report = (item: ReturnType<typeof change>) =>
      runner.send({ type: 'local.changed', projectId, vaultKeyVersion: 1, full: false, items: [item], unreadable: [] } as never);
    const heads = async () => (await sql<{ head_sha: string }>('SELECT head_sha FROM code_changes WHERE project_id = $1 AND number = 3', [projectId])).map((row) => row.head_sha);

    report(change(SHA, '2026-11-20T09:00:00.000Z'));
    await eventually(async () => expect(await heads()).toEqual([SHA]));
    const pushed = 'c3'.repeat(20);
    report(change(pushed, '2026-11-20T09:05:00.000Z'));
    await eventually(async () => expect(await heads()).toEqual([pushed]));
  });
});
