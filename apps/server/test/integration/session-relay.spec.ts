import type { INestApplication } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
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

/** Bytes as the relay carries them: base64url, each value told apart by its byte. */
const bytes = (byte: number, length: number): string => Buffer.alloc(length, byte).toString('base64url');
const WRAP = { holderId: bytes(0xa1, 32), enc: bytes(0xa2, 32), wrappedKey: bytes(0xa3, 48), tag: bytes(0xa4, 32) };
const FRAME = { nonce: bytes(0xb1, 12), ciphertext: bytes(0xb2, 64) };
const LIVE = { nonce: bytes(0xc1, 12), ciphertext: bytes(0xc2, 64) };
const INPUT = { nonce: bytes(0xd1, 12), ciphertext: bytes(0xd2, 64) };
const SECRETS = [WRAP.enc, WRAP.wrappedKey, FRAME.nonce, FRAME.ciphertext, LIVE.nonce, LIVE.ciphertext, INPUT.nonce, INPUT.ciphertext];

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

describe('the relay of a Session against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  const lines: string[] = [];
  const closers: (WsClient | FakeRunnerClient)[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp(env, { logs: { write: (line: string) => lines.push(line) } }));
    prisma = app.get(PrismaService);
    // What a relay frame logs is debug: the test reads it.
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

  /**
   * A Pilote with a Projet and one Session: its cookie, its Session's id, its
   * Runner's token. The Session is past (`interrupted`): the Runner's hello
   * interrupts a live one, a write of its own while frames are relayed.
   */
  const pilot = async (login: string): Promise<{ id: string; cookie: string; sessionId: string; token: string }> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone, getting_started_step) VALUES ($1, $2, $3, 'Europe/Paris', 'done')`, [
      id,
      Math.floor(Math.random() * 1e9),
      login,
    ]);
    const projectId = newId();
    await sql(
      `INSERT INTO projects (id, pilot_id, repository_id, github_repo_id, owner, name, full_name, display_name, release_branch, integration_branch, has_code, inventory_state)
       VALUES ($1, $2, $3, $4, 'acme', 'shop', 'acme/shop', 'shop', 'main', 'develop', true, 'not-needed')`,
      [projectId, id, newId(), Math.floor(Math.random() * 1e9)],
    );
    const sessionId = newId();
    await sql(
      `INSERT INTO agent_sessions (id, pilot_id, project_id, role, engine, model, title, branch, base, permission_mode, state, interrupted_reason, started_at, last_seq)
       VALUES ($1, $2, $3, 'code', 'claude-code', 'claude-opus-5-5', 'Le panier', 'feat/12-panier', 'develop', 'bypass', 'interrupted', 'runner-restarted', now(), 0)`,
      [sessionId, id, projectId],
    );
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    const runner = await createLinkedRunner(prisma, id);
    return { id, cookie: `${SESSION_COOKIE}=${token}`, sessionId, token: runner.token };
  };

  const tab = async (cookie: string): Promise<WsClient> => {
    const client = await connect(url, { cookie, origin: ORIGIN });
    closers.push(client);
    // An answered ping: the socket's Pilote is known, its messages are handled.
    client.send({ type: 'ping' });
    await client.next('pong');
    return client;
  };

  const online = async ({ token }: { token: string }): Promise<FakeRunnerClient> => {
    const socket = await connectRunner(url, token);
    closers.push(socket);
    socket.hello();
    await socket.expect('hello.accepted');
    return socket;
  };

  it('relays a Session between the Runner and the tab that opened it only, writing nothing to the database and logging none of its frames', async () => {
    const alice = await pilot('alice');
    const runner = await online(alice);
    const opener = await tab(alice.cookie);
    const other = await tab(alice.cookie);
    const queries = spyQueries();

    try {
      opener.send({ type: 'session.open', sessionId: alice.sessionId, fromSeq: 1 });
      const replay = await runner.expect('session.replay');
      expect(replay).toMatchObject({ sessionId: alice.sessionId, fromSeq: 1, tabId: expect.any(String) });

      runner.send({ type: 'session.keys', sessionId: alice.sessionId, tabId: replay.tabId, wraps: [WRAP] });
      runner.send({ type: 'relay', sessionId: alice.sessionId, tabId: replay.tabId, seq: 1, ...FRAME });
      runner.send({ type: 'relay', sessionId: alice.sessionId, seq: 2, ...LIVE });
      expect(await opener.next('session.keys')).toEqual({ type: 'session.keys', sessionId: alice.sessionId, wraps: [WRAP] });
      expect(await opener.next('relay')).toEqual({ type: 'relay', sessionId: alice.sessionId, seq: 1, ...FRAME });
      expect(await opener.next('relay')).toEqual({ type: 'relay', sessionId: alice.sessionId, seq: 2, ...LIVE });

      const inputId = newId();
      opener.send({ type: 'session.input', sessionId: alice.sessionId, inputId, ...INPUT });
      expect(await runner.expect('session.input')).toMatchObject({ sessionId: alice.sessionId, tabId: replay.tabId, inputId, ...INPUT });

      other.send({ type: 'ping' });
      await other.next('pong');
      expect(other.collect().map((message) => message.type)).toEqual(['pong', 'pong']);
      // The spy sees the server's queries: the open's read of the Session is one.
      expect(queries.all().some((text) => /agent_sessions/.test(text))).toBe(true);
      expect(queries.writes()).toEqual([]);
    } finally {
      queries.stop();
    }

    const output = lines.join('');
    for (const secret of SECRETS) expect(output).not.toContain(secret);
    const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logged).toContainEqual(expect.objectContaining({ msg: 'session relay', type: 'relay', sessionId: alice.sessionId }));
    expect(logged).toContainEqual(expect.objectContaining({ msg: 'session relay', type: 'session.input', sessionId: alice.sessionId }));
  });

  it('answers session.not-found to the open of another Pilote’s Session, and asks nothing of the Runner', async () => {
    const alice = await pilot('alice');
    const bob = await pilot('bob');
    const runner = await online(alice);
    const client = await tab(alice.cookie);

    client.send({ type: 'session.open', sessionId: bob.sessionId, fromSeq: 1 });
    expect(await client.next('session.error')).toEqual({ type: 'session.error', sessionId: bob.sessionId, code: 'session.not-found' });
    client.send({ type: 'session.input', sessionId: bob.sessionId, inputId: newId(), ...INPUT });
    expect(await client.next('session.error')).toEqual({ type: 'session.error', sessionId: bob.sessionId, code: 'session.not-found' });

    runner.heartbeat();
    await runner.expect('heartbeat.ack');
    expect(runner.received().map((message) => message.type)).toEqual(['hello.accepted', 'heartbeat.ack']);
  });

  it('answers session.runner-offline while the Runner is away, and asks its replay for the open Session once its hello is accepted', async () => {
    const alice = await pilot('alice');
    const client = await tab(alice.cookie);

    client.send({ type: 'session.open', sessionId: alice.sessionId, fromSeq: 4 });
    expect(await client.next('session.error')).toEqual({ type: 'session.error', sessionId: alice.sessionId, code: 'session.runner-offline' });
    client.send({ type: 'session.input', sessionId: alice.sessionId, inputId: newId(), ...INPUT });
    expect(await client.next('session.error')).toEqual({ type: 'session.error', sessionId: alice.sessionId, code: 'session.runner-offline' });

    const runner = await online(alice);
    expect(await runner.expect('session.replay')).toMatchObject({ sessionId: alice.sessionId, fromSeq: 4, tabId: expect.any(String) });
    expect(runner.received().filter((message) => message.type === 'session.input')).toEqual([]);
  });
});
