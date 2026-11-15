import { type Event, PROTOCOL_VERSION, RUNNER_WS_CLOSE, zRunner, zState } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { getLoggerToken, type PinoLogger } from 'nestjs-pino';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { EventsBus } from '../../src/realtime/events.bus.js';
import { Transactions } from '../../src/realtime/transactions.js';
import { RunnerClock } from '../../src/runners/clock.js';
import { RunnerProtocol } from '../../src/runners/protocol-version.js';
import { RunnerCommands } from '../../src/runners/runner-commands.service.js';
import { RunnerPresence } from '../../src/runners/runner-presence.service.js';
import { RunnerSweep } from '../../src/runners/runner-sweep.job.js';
import { RunnersGateway } from '../../src/runners/runners.gateway.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
import { connectRunner, type FakeRunnerClient } from '../fakes/runner.js';
import { expectEnvelope, startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl, CREWDECK_COMMIT: 'abc1234' });

const sql = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
};

interface RunnerRow {
  state: string;
  last_seen_at: Date;
  machine: string;
  protocol_version: number;
}

describe('the Runner protocol against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let clock: RunnerClock;
  const runners: FakeRunnerClient[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    prisma = app.get(PrismaService);
    clock = app.get(RunnerClock);
    // The tests sweep by hand: the interval's own sweeps would race them.
    app.get(SchedulerRegistry).deleteInterval('runner-sweep');
  });

  afterAll(async () => {
    await sql('TRUNCATE pilots CASCADE');
    await app.close();
  });

  beforeEach(() => sql('TRUNCATE pilots CASCADE'));

  afterEach(async () => {
    await Promise.all(runners.splice(0).map((runner) => runner.close()));
    clock.now = () => new Date();
    app.get(RunnerProtocol).version = PROTOCOL_VERSION;
    vi.restoreAllMocks();
  });

  /** A Pilote with a session: their id and the cookie of a tab. */
  const pilot = async (login = 'octocat'): Promise<{ id: string; cookie: string }> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone) VALUES ($1, $2, $3, 'Europe/Paris')`, [id, Math.floor(Math.random() * 1e9), login]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  const open = async (token?: string): Promise<FakeRunnerClient> => {
    const runner = await connectRunner(url, token);
    runners.push(runner);
    return runner;
  };

  /** Opens the socket of `token` and has its `hello` accepted. */
  const online = async (token: string): Promise<FakeRunnerClient> => {
    const runner = await open(token);
    runner.hello();
    await runner.expect('hello.accepted');
    return runner;
  };

  const rowOf = async (runnerId: string): Promise<RunnerRow> => {
    const [row] = await sql<RunnerRow>('SELECT state, last_seen_at, machine, protocol_version FROM runners WHERE id = $1', [runnerId]);
    if (!row) throw new Error(`no runner ${runnerId}`);
    return row;
  };

  const eventsOf = (pilotId: string): Promise<{ type: string; payload: { state: string; id: string } }[]> =>
    sql('SELECT type, payload FROM events WHERE pilot_id = $1 ORDER BY seq', [pilotId]);

  /** Moves the Runners' clock `seconds` ahead of now. */
  const advance = (seconds: number): void => {
    const at = Date.now() + seconds * 1000;
    clock.now = () => new Date(at);
  };

  describe('hello', () => {
    it('accepts a valid token: hello.accepted, the Runner online and runner.upserted in the same transaction', async () => {
      const alice = await pilot();
      const { runner, token } = await createLinkedRunner(prisma, alice.id, { machine: 'ancienne' });
      const published: Event[] = [];
      app.get(EventsBus).subscribe(alice.id, (event) => published.push(event));

      const socket = await open(token);
      socket.hello({ machine: 'atelier', runnerVersion: '0.1.0' });
      const accepted = await socket.expect('hello.accepted');

      expect(accepted).toMatchObject({ runnerId: runner.id, protocolVersion: PROTOCOL_VERSION });
      expect(await rowOf(runner.id)).toMatchObject({ state: 'online', machine: 'atelier', protocol_version: PROTOCOL_VERSION });
      const events = await eventsOf(alice.id);
      expect(events).toEqual([{ type: 'runner.upserted', payload: expect.objectContaining({ id: runner.id, state: 'online', machine: 'atelier' }) }]);
      // The event committed with the row: published, and the Pilote's seq is its seq.
      expect(zRunner.parse(published[0]?.payload)).toMatchObject({ state: 'online' });
      const [{ seq }] = (await sql<{ seq: string }>('SELECT seq FROM pilots WHERE id = $1', [alice.id])) as [{ seq: string }];
      expect(Number(seq)).toBe(published[0]?.seq);
      expect(app.get(RunnerPresence).isOnline(alice.id)).toBe(true);
    });

    it('answers a heartbeat with heartbeat.ack and moves lastSeenAt, without an event', async () => {
      const alice = await pilot();
      const { runner, token } = await createLinkedRunner(prisma, alice.id);
      const socket = await online(token);
      const before = (await rowOf(runner.id)).last_seen_at;

      advance(10);
      socket.heartbeat();
      await socket.expect('heartbeat.ack');

      expect((await rowOf(runner.id)).last_seen_at.getTime()).toBeGreaterThan(before.getTime());
      expect(await eventsOf(alice.id)).toHaveLength(1);
    });

    // At version 1 there is no version before: the window is tried at 3.
    it('accepts the protocol before the server’s (N-1), at that version', async () => {
      app.get(RunnerProtocol).version = 3;
      const alice = await pilot();
      const { runner, token } = await createLinkedRunner(prisma, alice.id);
      const socket = await open(token);

      socket.hello({ protocolVersion: 2 });

      expect(await socket.expect('hello.accepted')).toMatchObject({ protocolVersion: 2 });
      expect((await rowOf(runner.id)).protocol_version).toBe(2);
    });

    it('accepts a newer protocol at the server’s', async () => {
      const alice = await pilot();
      const { token } = await createLinkedRunner(prisma, alice.id);
      const socket = await open(token);

      socket.hello({ protocolVersion: PROTOCOL_VERSION + 1 });

      expect(await socket.expect('hello.accepted')).toMatchObject({ protocolVersion: PROTOCOL_VERSION });
    });

    it('rejects an older protocol (N-2): hello.rejected update-required with the version to update to, then 4426', async () => {
      app.get(RunnerProtocol).version = 3;
      const alice = await pilot();
      const { runner, token } = await createLinkedRunner(prisma, alice.id);
      const socket = await open(token);

      socket.hello({ protocolVersion: 1 });

      expect(await socket.expect('hello.rejected')).toMatchObject({ reason: 'update-required', latestVersion: 'abc1234' });
      expect((await socket.closed()).code).toBe(RUNNER_WS_CLOSE.updateRequired);
      expect((await rowOf(runner.id)).state).toBe('offline');
      expect(await eventsOf(alice.id)).toEqual([]);
    });

    it('rejects an unknown token with hello.rejected unknown-token, then 4401', async () => {
      const socket = await open('not-a-token');

      expect(await socket.expect('hello.rejected')).toMatchObject({ reason: 'unknown-token' });
      expect((await socket.closed()).code).toBe(RUNNER_WS_CLOSE.unauthorized);
    });

    it('rejects a socket without a token, then 4401', async () => {
      const socket = await open();

      expect(await socket.expect('hello.rejected')).toMatchObject({ reason: 'unknown-token' });
      expect((await socket.closed()).code).toBe(RUNNER_WS_CLOSE.unauthorized);
    });

    it('rejects a revoked token with hello.rejected revoked, then 4401', async () => {
      const alice = await pilot();
      const { runner, token } = await createLinkedRunner(prisma, alice.id);
      await sql('UPDATE runners SET revoked_at = now() WHERE id = $1', [runner.id]);
      const socket = await open(token);

      expect(await socket.expect('hello.rejected')).toMatchObject({ reason: 'revoked' });
      expect((await socket.closed()).code).toBe(RUNNER_WS_CLOSE.unauthorized);
    });

    it('answers a message before hello with error protocol.hello-required', async () => {
      const alice = await pilot();
      const { runner, token } = await createLinkedRunner(prisma, alice.id);
      const socket = await open(token);

      socket.heartbeat();

      expect(await socket.expect('error')).toMatchObject({ code: 'protocol.hello-required' });
      expect((await rowOf(runner.id)).state).toBe('offline');
    });
  });

  describe('one socket per Runner', () => {
    it('closes the first socket with 4409 when a second one says hello with the same token', async () => {
      const alice = await pilot();
      const { runner, token } = await createLinkedRunner(prisma, alice.id);
      const first = await online(token);

      const second = await online(token);

      expect((await first.closed()).code).toBe(RUNNER_WS_CLOSE.replaced);
      // The replaced socket's close leaves the Runner online, on its new socket.
      second.heartbeat();
      await second.expect('heartbeat.ack');
      expect((await rowOf(runner.id)).state).toBe('online');
      expect(app.get(RunnerPresence).isOnline(alice.id)).toBe(true);
    });

    it('calls onOnline for the new socket only, after its hello.accepted, when it replaces one whose hello is still committing', async () => {
      const alice = await pilot();
      const { token } = await createLinkedRunner(prisma, alice.id);
      const online = vi.fn(() => app.get(RunnerCommands).send(alice.id, { type: 'heartbeat.ack' }));
      app.get(RunnerPresence).onOnline(alice.id, online);
      // The first hello's transaction waits until the second socket has replaced the first.
      const transactions = app.get(Transactions);
      const run = transactions.run.bind(transactions);
      let release = (): void => undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      let started = (): void => undefined;
      const firstStarted = new Promise<void>((resolve) => (started = resolve));
      vi.spyOn(transactions, 'run').mockImplementationOnce(async (fn) => {
        started();
        await held;
        return run(fn);
      });
      const first = await open(token);
      first.hello();
      await firstStarted;

      const second = await open(token);
      second.hello();
      expect((await first.closed()).code).toBe(RUNNER_WS_CLOSE.replaced);
      release();
      await second.expect('heartbeat.ack');

      expect(second.received().map((message) => message.type)).toEqual(['hello.accepted', 'heartbeat.ack']);
      expect(online).toHaveBeenCalledOnce();
    });
  });

  describe('presence', () => {
    it('goes offline without a heartbeat for 45 s, with its event, and back online at the next heartbeat', async () => {
      const alice = await pilot();
      const { runner, token } = await createLinkedRunner(prisma, alice.id);
      const socket = await online(token);
      const presence = app.get(RunnerPresence);
      const offline = vi.fn();
      const backOnline = vi.fn();
      presence.onOffline(alice.id, offline);
      presence.onOnline(alice.id, backOnline);

      advance(44);
      expect(await app.get(RunnerSweep).sweep()).toBe(0);
      expect((await rowOf(runner.id)).state).toBe('online');

      advance(46);
      expect(await app.get(RunnerSweep).sweep()).toBe(1);
      expect((await rowOf(runner.id)).state).toBe('offline');
      expect(presence.isOnline(alice.id)).toBe(false);
      expect(offline).toHaveBeenCalledWith(runner.id);
      expect((await eventsOf(alice.id)).map((event) => event.payload.state)).toEqual(['online', 'offline']);

      socket.heartbeat();
      await socket.expect('heartbeat.ack');

      expect((await rowOf(runner.id)).state).toBe('online');
      expect(presence.isOnline(alice.id)).toBe(true);
      expect(backOnline).toHaveBeenCalledWith(runner.id);
      expect((await eventsOf(alice.id)).map((event) => event.payload.state)).toEqual(['online', 'offline', 'online']);
    });

    it('goes offline at once when its socket closes, with its event', async () => {
      const alice = await pilot();
      const { runner, token } = await createLinkedRunner(prisma, alice.id);
      const socket = await online(token);

      await socket.close();

      await vi.waitFor(async () => expect((await rowOf(runner.id)).state).toBe('offline'));
      expect((await eventsOf(alice.id)).map((event) => event.payload.state)).toEqual(['online', 'offline']);
      expect(app.get(RunnerPresence).isOnline(alice.id)).toBe(false);
    });

    it('sweeps a Runner left online with no socket (a server restarted)', async () => {
      const alice = await pilot();
      const { runner } = await createLinkedRunner(prisma, alice.id);
      await sql(`UPDATE runners SET state = 'online', last_seen_at = now() - interval '1 minute' WHERE id = $1`, [runner.id]);

      const offline = vi.fn();
      app.get(RunnerPresence).onOffline(alice.id, offline);

      expect(await app.get(RunnerSweep).sweep()).toBe(1);

      expect((await rowOf(runner.id)).state).toBe('offline');
      expect((await eventsOf(alice.id)).map((event) => event.payload.state)).toEqual(['offline']);
      // The transition was committed: its hooks hear of it, though the process never saw the Runner online.
      expect(offline).toHaveBeenCalledExactlyOnceWith(runner.id);
      expect(await app.get(RunnerSweep).sweep()).toBe(0);
      expect(offline).toHaveBeenCalledOnce();
    });

    it('calls onOffline once when the socket of a Runner swept offline then closes', async () => {
      const alice = await pilot();
      const { runner, token } = await createLinkedRunner(prisma, alice.id);
      const socket = await online(token);
      const offline = vi.fn();
      app.get(RunnerPresence).onOffline(alice.id, offline);
      advance(46);
      await app.get(RunnerSweep).sweep();

      await socket.close();

      await vi.waitFor(() => expect(app.get(RunnerPresence).isOnline(alice.id)).toBe(false));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(offline).toHaveBeenCalledExactlyOnceWith(runner.id);
    });

    it('sends hello.accepted before what an onOnline hook sends', async () => {
      const alice = await pilot();
      const { token } = await createLinkedRunner(prisma, alice.id);
      app.get(RunnerPresence).onOnline(alice.id, () => app.get(RunnerCommands).send(alice.id, { type: 'heartbeat.ack' }));

      const socket = await online(token);
      await socket.expect('heartbeat.ack');

      expect(socket.received().map((message) => message.type)).toEqual(['hello.accepted', 'heartbeat.ack']);
    });

    it('removes a hook with what onOnline returns', async () => {
      const alice = await pilot();
      const { token } = await createLinkedRunner(prisma, alice.id);
      const handler = vi.fn();
      app.get(RunnerPresence).onOnline(alice.id, handler)();

      await online(token);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('RunnerCommands.send', () => {
    it('sends a message to the connected Runner', async () => {
      const alice = await pilot();
      const { token } = await createLinkedRunner(prisma, alice.id);
      const socket = await online(token);

      app.get(RunnerCommands).send(alice.id, { type: 'heartbeat.ack' });

      expect(await socket.expect('heartbeat.ack')).toMatchObject({ type: 'heartbeat.ack' });
    });

    it('throws runner.offline (422) when the Runner is not connected', async () => {
      const alice = await pilot();
      await createLinkedRunner(prisma, alice.id);

      expect(() => app.get(RunnerCommands).send(alice.id, { type: 'heartbeat.ack' })).toThrow(
        expect.objectContaining({ status: 422, code: 'runner.offline', message: 'Le Runner est hors ligne.' }),
      );
    });

    it('throws runner.offline once the Runner is swept offline, its socket still open', async () => {
      const alice = await pilot();
      const { token } = await createLinkedRunner(prisma, alice.id);
      await online(token);
      advance(46);
      await app.get(RunnerSweep).sweep();

      expect(() => app.get(RunnerCommands).send(alice.id, { type: 'heartbeat.ack' })).toThrow(expect.objectContaining({ code: 'runner.offline' }));
    });

    it('refuses a message outside ServerToRunner', async () => {
      const alice = await pilot();
      const { token } = await createLinkedRunner(prisma, alice.id);
      await online(token);

      expect(() => app.get(RunnerCommands).send(alice.id, { type: 'hello.accepted', runnerId: 'not-an-id', protocolVersion: 1 })).toThrow();
    });
  });

  describe('invalid messages', () => {
    it('answers error protocol.invalid and logs its type and size only, never its content', async () => {
      const alice = await pilot();
      const { token } = await createLinkedRunner(prisma, alice.id);
      const socket = await online(token);
      const logger = app.get<PinoLogger>(getLoggerToken(RunnersGateway.name));
      const warn = vi.spyOn(logger, 'warn');
      const debug = vi.spyOn(logger, 'debug');
      const secret = 'secret-relay-payload-31ab';

      socket.send(JSON.stringify({ type: 'relay', id: newId(), at: new Date().toISOString(), payload: secret }));
      socket.send(`not json ${secret}`);

      const first = await socket.expect('error');
      const second = await socket.expect('error');
      expect([first.code, second.code]).toEqual(['protocol.invalid', 'protocol.invalid']);
      expect(warn).toHaveBeenCalledWith({ direction: 'in', type: 'invalid', bytes: expect.any(Number) }, 'invalid runner message');
      for (const call of [...warn.mock.calls, ...debug.mock.calls]) expect(JSON.stringify(call)).not.toContain(secret);
      // Still open: a heartbeat is answered.
      socket.heartbeat();
      await socket.expect('heartbeat.ack');
    });

    it('answers a second hello with error protocol.invalid', async () => {
      const alice = await pilot();
      const { token } = await createLinkedRunner(prisma, alice.id);
      const socket = await online(token);

      socket.hello();

      expect(await socket.expect('error')).toMatchObject({ code: 'protocol.invalid' });
    });
  });

  describe('GET /api/runner', () => {
    it('returns the Pilote’s Runner, matching zRunner', async () => {
      const alice = await pilot();
      const { runner, token } = await createLinkedRunner(prisma, alice.id);
      await online(token);

      const res = await fetch(`${url}/api/runner`, { headers: { cookie: alice.cookie } });

      expect(res.status).toBe(200);
      expect(zRunner.parse(await res.json())).toMatchObject({ id: runner.id, state: 'online', machine: 'atelier', os: 'linux', arch: 'amd64', wsl: true });
    });

    it('answers 401 without a session', async () => {
      await expectEnvelope(await fetch(`${url}/api/runner`), 401, 'auth.required');
    });

    it('answers 404 runner.not-linked without a Runner', async () => {
      const alice = await pilot();

      const envelope = await expectEnvelope(await fetch(`${url}/api/runner`, { headers: { cookie: alice.cookie } }), 404, 'runner.not-linked');

      expect(envelope.message).toBe('Aucun Runner n’est relié à ton compte.');
    });

    it('never returns another Pilote’s Runner, nor a revoked one', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      await createLinkedRunner(prisma, bob.id);
      const { runner: revoked } = await createLinkedRunner(prisma, alice.id);
      await sql('UPDATE runners SET revoked_at = now() WHERE id = $1', [revoked.id]);

      await expectEnvelope(await fetch(`${url}/api/runner`, { headers: { cookie: alice.cookie } }), 404, 'runner.not-linked');
    });
  });

  describe('GET /api/state', () => {
    it('has the runner slice: the Pilote’s Runner, or null', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const { runner } = await createLinkedRunner(prisma, alice.id);

      const forAlice = zState.parse(await (await fetch(`${url}/api/state`, { headers: { cookie: alice.cookie } })).json());
      const forBob = zState.parse(await (await fetch(`${url}/api/state`, { headers: { cookie: bob.cookie } })).json());

      expect(forAlice.runner).toEqual(runner);
      expect(forBob.runner).toBeNull();
    });
  });
});
