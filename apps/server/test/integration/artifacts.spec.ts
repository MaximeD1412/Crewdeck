import { projectFolderAad, projectNameAad } from '@crewdeck/contracts';
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
import { RunnerConnections } from '../../src/runners/runner-connections.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
import { sealItem } from '../../src/testing/vault.js';
import { connectRunner, type FakeRunnerClient } from '../fakes/runner.js';
import { connect, type WsClient } from '../fakes/ws-client.js';
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

/** The SQL statements a client of `pg` (Prisma's adapter among them) sends from now on. */
const spyQueries = () => {
  const spy = vi.spyOn(pg.Client.prototype, 'query');
  const all = (): string[] => spy.mock.calls.map(([query]) => (typeof query === 'string' ? query : ((query as { text?: string }).text ?? '')));
  return {
    all,
    writes: () => all().filter((text) => /^\s*(insert|update|delete|merge|upsert)\b/i.test(text)),
    stop: () => spy.mockRestore(),
  };
};

/** In the path the tab asks and in the content the Runner answers: never in the database nor the logs. */
const MARKER = 'MARQUEUR-7f3a9c';
const bytes = (byte: number, length: number): string => Buffer.alloc(length, byte).toString('base64url');
const HOLDER = bytes(0xa1, 32);
const WRAP = { holderId: HOLDER, enc: bytes(0xa2, 32), wrappedKey: bytes(0xa3, 48), tag: bytes(0xa4, 32) };
// The sealed answer, as opaque to the server as a real one: here the marker's own bytes, so that a copy of them anywhere shows.
const SEALED = { nonce: bytes(0xb1, 12), ciphertext: Buffer.from(`# Plan ${MARKER} et sa suite, scellée`).toString('base64url') };

interface Pilot {
  id: string;
  cookie: string;
  token: string;
}

describe('the relay of an artefact read in the page, against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  const lines: string[] = [];
  const closers: (WsClient | FakeRunnerClient)[] = [];
  const vaultKey = randomBytes(32);

  beforeAll(async () => {
    ({ app, url } = await startApp(env, { logs: { write: (line: string) => lines.push(line) } }));
    prisma = app.get(PrismaService);
    // What the relay logs is debug: the test reads it.
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
    await Promise.all(closers.splice(0).map((closer) => closer.close()));
  });

  const pilot = async (login: string): Promise<Pilot> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, display_name, time_zone, getting_started_step, vault_key_version) VALUES ($1, $2, 'Europe/Paris', 'projects', 1)`, [id, login]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    const runner = await createLinkedRunner(prisma, id);
    return { id, cookie: `${SESSION_COOKIE}=${token}`, token: runner.token };
  };

  /** A Local Projet of `who`: its release branch `trunk`, its integration branch the default `develop`. */
  const localProject = async (who: Pilot): Promise<string> => {
    const id = newId();
    const res = await fetch(`${url}/api/projects/local`, {
      method: 'POST',
      headers: { cookie: who.cookie, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({
        id,
        nameSealed: sealItem(vaultKey, 'Recettes', projectNameAad(id)),
        folderSealed: sealItem(vaultKey, JSON.stringify({ path: '/home/pilote/recettes' }), projectFolderAad(id)),
        vaultKeyVersion: 1,
        hasCode: true,
        releaseBranch: 'trunk',
        templateId: 'process-crewdeck',
      }),
    });
    expect(res.status).toBe(201);
    return id;
  };

  const tab = async (who: Pilot): Promise<WsClient> => {
    const client = await connect(url, { cookie: who.cookie, origin: ORIGIN });
    closers.push(client);
    // An answered ping: the socket's Pilote is known, its messages are handled.
    client.send({ type: 'ping' });
    await client.next('pong');
    return client;
  };

  const online = async ({ token }: Pilot): Promise<FakeRunnerClient> => {
    const socket = await connectRunner(url, token);
    closers.push(socket);
    socket.hello();
    await socket.expect('hello.accepted');
    return socket;
  };

  it('relays a Local Projet’s file from the Runner, sealed, to the tab that asked only, writing nothing and logging none of it', async () => {
    const alice = await pilot('alice');
    const runner = await online(alice);
    const projectId = await localProject(alice);
    const asker = await tab(alice);
    const other = await tab(alice);
    const requestId = newId();
    const queries = spyQueries();

    try {
      asker.send({ type: 'artifact.read', requestId, projectId, holderId: HOLDER, kind: 'file', ref: { path: `docs/${MARKER}.md` } });
      const read = await runner.expect('artifact.read');
      expect(read).toMatchObject({ requestId, projectId, holderId: HOLDER, kind: 'file', ref: { path: `docs/${MARKER}.md`, at: 'develop' }, tabId: expect.any(String) });

      runner.send({ type: 'artifact.content', requestId, tabId: read.tabId, wrap: WRAP, ...SEALED });
      expect(await asker.next('artifact.content')).toEqual({ type: 'artifact.content', requestId, wrap: WRAP, ...SEALED });

      other.send({ type: 'ping' });
      await other.next('pong');
      expect(other.collect().map((message) => message.type)).toEqual(['pong', 'pong']);
      // The spy sees the server's queries: the read of the Projet is one.
      expect(queries.all().some((text) => /projects/.test(text))).toBe(true);
      expect(queries.writes()).toEqual([]);
    } finally {
      queries.stop();
    }

    const stored = await database();
    const output = lines.join('');
    for (const secret of [MARKER, SEALED.ciphertext, WRAP.wrappedKey, WRAP.enc]) {
      expect(stored).not.toContain(secret);
      expect(output).not.toContain(secret);
    }
    const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logged).toContainEqual(expect.objectContaining({ msg: 'artifact relay', type: 'artifact.read', requestId, kind: 'file' }));
    expect(logged).toContainEqual(expect.objectContaining({ msg: 'artifact relay', type: 'artifact.content', requestId }));
  });

  it('answers artifact.not-found to a read of another Pilote’s Projet, and asks nothing of the Runner', async () => {
    const alice = await pilot('alice');
    const bob = await pilot('bob');
    const bobsRunner = await online(bob);
    const bobsProject = await localProject(bob);
    await bobsRunner.close();
    const runner = await online(alice);
    const client = await tab(alice);
    const requestId = newId();

    client.send({ type: 'artifact.read', requestId, projectId: bobsProject, holderId: HOLDER, kind: 'ticket', ref: { number: 12 } });
    expect(await client.next('artifact.error')).toEqual({ type: 'artifact.error', requestId, code: 'artifact.not-found' });

    runner.heartbeat();
    await runner.expect('heartbeat.ack');
    expect(runner.received().map((message) => message.type)).toEqual(['hello.accepted', 'heartbeat.ack']);
  });

  it('answers artifact.runner-offline at once while the Runner is away, and forwards its artifact.error once it is back', async () => {
    const alice = await pilot('alice');
    // A Local Projet is created with its Runner online, which then goes away.
    const away = await online(alice);
    const projectId = await localProject(alice);
    await away.close();
    await vi.waitFor(() => expect(app.get(RunnerConnections).of(alice.id)).toBeUndefined());
    const client = await tab(alice);
    const first = newId();

    client.send({ type: 'artifact.read', requestId: first, projectId, holderId: HOLDER, kind: 'ticket', ref: { number: 12 } });
    expect(await client.next('artifact.error')).toEqual({ type: 'artifact.error', requestId: first, code: 'artifact.runner-offline' });

    const runner = await online(alice);
    const second = newId();
    client.send({ type: 'artifact.read', requestId: second, projectId, holderId: HOLDER, kind: 'ticket', ref: { number: 12 } });
    const read = await runner.expect('artifact.read');
    runner.send({ type: 'artifact.error', requestId: second, tabId: read.tabId, code: 'artifact.untrusted-device' });
    expect(await client.next('artifact.error')).toEqual({ type: 'artifact.error', requestId: second, code: 'artifact.untrusted-device' });
  });
});
