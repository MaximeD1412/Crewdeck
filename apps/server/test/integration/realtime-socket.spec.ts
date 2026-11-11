import { type Event, WS_CLOSE } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import { getLoggerToken, type PinoLogger } from 'nestjs-pino';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { EventsReplay } from '../../src/realtime/events.replay.js';
import { EventsWriter } from '../../src/realtime/events.writer.js';
import { RealtimeGateway } from '../../src/realtime/realtime.gateway.js';
import { RealtimeTiming } from '../../src/realtime/realtime.timing.js';
import { TabPresence } from '../../src/realtime/tab-presence.js';
import { Transactions } from '../../src/realtime/transactions.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { connect, type WsClient } from '../fakes/ws-client.js';
import { startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl });
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

describe('/api/ws against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  const clients: WsClient[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await sql('TRUNCATE pilots CASCADE');
    await app.close();
  });

  beforeEach(() => sql('TRUNCATE pilots CASCADE'));

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    app.get(RealtimeTiming).silenceMs = 60_000;
  });

  /** A Pilote with a session: their id and the cookie of a tab. */
  const pilot = async (login = 'octocat'): Promise<{ id: string; cookie: string }> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone) VALUES ($1, $2, $3, 'Europe/Paris')`, [id, Math.floor(Math.random() * 1e9), login]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  /** Commits `count` events of `pilotId`, one transaction each; their seqs. */
  const emit = async (pilotId: string, count = 1, login = 'octocat'): Promise<number[]> => {
    const seqs: number[] = [];
    for (let i = 0; i < count; i++) {
      const seq = await runInPilotScope(pilotId, () =>
        app.get(Transactions).run((tx) => app.get(EventsWriter).write(tx, pilotId, 'pilot.upserted', { id: pilotId, login, avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done' })),
      );
      seqs.push(Number(seq));
    }
    return seqs;
  };

  const open = async (cookie?: string, origin = ORIGIN): Promise<WsClient> => {
    const client = await connect(url, { ...(cookie ? { cookie } : {}), origin });
    clients.push(client);
    return client;
  };

  const seqsOf = (client: WsClient): (number | 'live' | 'snapshot-required')[] =>
    client.collect().flatMap((message): (number | 'live' | 'snapshot-required')[] => {
      if (message.type === 'event') return [message.event.seq];
      if (message.type === 'live' || message.type === 'snapshot-required') return [message.type];
      return [];
    });

  describe('authentication', () => {
    it('closes a socket without a cookie, with an unknown one, or from another origin, with 4401', async () => {
      const { cookie } = await pilot();

      for (const client of [await open(), await open(`${SESSION_COOKIE}=nope`), await open(cookie, 'https://evil.example')]) {
        expect((await client.closed()).code).toBe(WS_CLOSE.unauthorized);
      }
    });
  });

  describe('the session', () => {
    it('closes a socket, even one that pings, once its session expires', async () => {
      const { cookie } = await pilot();
      await sql(`UPDATE web_sessions SET expires_at = now() + interval '700 milliseconds'`);
      const client = await open(cookie);
      const pings = setInterval(() => client.send({ type: 'ping' }), 100);

      try {
        await client.next('pong');
        expect(await client.closed()).toEqual({ code: WS_CLOSE.unauthorized, reason: 'expired' });
      } finally {
        clearInterval(pings);
      }
    });

    it('keeps a socket open past the expiry it was opened with when the session slid meanwhile', async () => {
      const { cookie } = await pilot();
      await sql(`UPDATE web_sessions SET expires_at = now() + interval '500 milliseconds'`);
      const client = await open(cookie);
      client.send({ type: 'ping' });
      await client.next('pong');
      await sql(`UPDATE web_sessions SET expires_at = now() + interval '1 day'`);

      await new Promise((resolve) => setTimeout(resolve, 800));
      client.send({ type: 'ping' });

      await expect(client.next('pong')).resolves.toEqual({ type: 'pong' });
    });

    it('closes a socket whose session ended while it was authenticated, without sending it anything', async () => {
      const { id, cookie } = await pilot();
      await emit(id, 2);
      const sessions = app.get(WebSessions);
      const expiryOf = sessions.expiryOf.bind(sessions);
      vi.spyOn(sessions, 'expiryOf').mockImplementationOnce(async (sessionId) => {
        await sql('DELETE FROM web_sessions WHERE pilot_id = $1', [id]);
        await new Promise((resolve) => setTimeout(resolve, 300));
        return expiryOf(sessionId);
      });

      const client = await open(cookie);
      client.send({ type: 'hello', lastSeq: 0 });
      client.send({ type: 'ping' });

      expect(await client.closed()).toEqual({ code: WS_CLOSE.unauthorized, reason: 'expired' });
      expect(client.collect()).toEqual([]);
    });
  });

  describe('hello', () => {
    it('replays every event after lastSeq, in order, then live', async () => {
      const { id, cookie } = await pilot();
      await emit(id, 5);

      const client = await open(cookie);
      client.send({ type: 'hello', lastSeq: 2 });
      await client.next('live');

      expect(seqsOf(client)).toEqual([3, 4, 5, 'live']);
      const event = client.collect()[0] as { type: 'event'; event: Event };
      expect(event.event).toMatchObject({ type: 'pilot.upserted', payload: { id, login: 'octocat' } });
    });

    it('replays nothing when the page is up to date, then streams what follows', async () => {
      const { id, cookie } = await pilot();
      await emit(id, 2);

      const client = await open(cookie);
      client.send({ type: 'hello', lastSeq: 2 });
      await client.next('live');
      await emit(id, 2);
      await client.next('event');
      await client.next('event');

      expect(seqsOf(client)).toEqual(['live', 3, 4]);
    });

    it('sends an event committed during the replay once, after live', async () => {
      const { id, cookie } = await pilot();
      await emit(id, 3);
      const replay = app.get(EventsReplay);
      const read = replay.after.bind(replay);
      vi.spyOn(replay, 'after').mockImplementationOnce(async (pilotId, lastSeq) => {
        const events = await read(pilotId, lastSeq);
        await emit(id, 1);
        return events;
      });

      const client = await open(cookie);
      client.send({ type: 'hello', lastSeq: 1 });
      await client.next('live');
      await client.next('event');

      expect(seqsOf(client)).toEqual([2, 3, 'live', 4]);
    });

    it('sends an event both read by the replay and published meanwhile only once', async () => {
      const { id, cookie } = await pilot();
      await emit(id, 2);
      const replay = app.get(EventsReplay);
      const read = replay.after.bind(replay);
      vi.spyOn(replay, 'after').mockImplementationOnce(async (pilotId, lastSeq) => {
        await emit(id, 1);
        return read(pilotId, lastSeq);
      });

      const client = await open(cookie);
      client.send({ type: 'hello', lastSeq: 0 });
      await client.next('live');
      await emit(id, 1);
      await client.next('event');

      expect(seqsOf(client)).toEqual([1, 2, 3, 'live', 4]);
    });

    it('answers snapshot-required to lastSeq null, and sends nothing live until the next hello', async () => {
      const { id, cookie } = await pilot();
      await emit(id, 2);

      const client = await open(cookie);
      client.send({ type: 'hello', lastSeq: null });
      await client.next('snapshot-required');
      await emit(id, 1);
      client.send({ type: 'hello', lastSeq: 3 });
      await client.next('live');

      expect(seqsOf(client)).toEqual(['snapshot-required', 'live']);
    });

    it('answers snapshot-required to a lastSeq older than the kept window, or ahead of the Pilote’s seq', async () => {
      const { id, cookie } = await pilot();
      await emit(id, 5);
      await sql('DELETE FROM events WHERE pilot_id = $1 AND seq <= 2', [id]);

      const tooOld = await open(cookie);
      tooOld.send({ type: 'hello', lastSeq: 1 });
      await tooOld.next('snapshot-required');
      const ahead = await open(cookie);
      ahead.send({ type: 'hello', lastSeq: 9 });
      await ahead.next('snapshot-required');
      const justKept = await open(cookie);
      justKept.send({ type: 'hello', lastSeq: 2 });
      await justKept.next('live');

      expect(seqsOf(justKept)).toEqual([3, 4, 5, 'live']);
    });

    it('never sends a Pilote’s socket another Pilote’s event', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      await emit(bob.id, 2, 'bob');

      const client = await open(alice.cookie);
      client.send({ type: 'hello', lastSeq: 0 });
      await client.next('live');
      await emit(bob.id, 1, 'bob');
      await emit(alice.id, 1, 'alice');
      await client.next('event');

      expect(seqsOf(client)).toEqual(['live', 1]);
      expect(client.collect()[1]).toMatchObject({ type: 'event', event: { payload: { id: alice.id, login: 'alice' } } });
    });
  });

  describe('the other messages', () => {
    it('answers ping with pong', async () => {
      const { cookie } = await pilot();
      const client = await open(cookie);

      client.send({ type: 'ping' });

      await expect(client.next('pong')).resolves.toEqual({ type: 'pong' });
    });

    it('keeps the visibility of each open tab, and forgets a closed one', async () => {
      const { id, cookie } = await pilot();
      const presence = app.get(TabPresence);
      const hidden = await open(cookie);
      const visible = await open(cookie);

      hidden.send({ type: 'visibility', visible: false });
      visible.send({ type: 'visibility', visible: true });
      hidden.send({ type: 'ping' });
      visible.send({ type: 'ping' });
      await hidden.next('pong');
      await visible.next('pong');

      expect(presence.tabsOf(id).map((tab) => tab.visible).sort()).toEqual([false, true]);
      for (const tab of presence.tabsOf(id)) expect(tab.since).toBeInstanceOf(Date);
      await hidden.close();
      await vi.waitFor(() => expect(presence.tabsOf(id).map((tab) => tab.visible)).toEqual([true]));
    });

    it('closes with 4400 a message that is not one of the protocol', async () => {
      const { cookie } = await pilot();

      for (const message of ['not json', JSON.stringify({ type: 'hello' }), JSON.stringify({ type: 'relay' })]) {
        const client = await open(cookie);
        client.send(message);
        expect((await client.closed()).code).toBe(WS_CLOSE.invalidMessage);
      }
    });

    it('closes a socket silent for too long with 4408, and keeps one that pings', async () => {
      const { cookie } = await pilot();
      app.get(RealtimeTiming).silenceMs = 300;
      const silent = await open(cookie);
      const pinging = await open(cookie);
      const pings = setInterval(() => pinging.send({ type: 'ping' }), 100);

      try {
        expect((await silent.closed()).code).toBe(WS_CLOSE.silent);
        await new Promise((resolve) => setTimeout(resolve, 200));
        pinging.send({ type: 'ping' });
        await expect(pinging.next('pong')).resolves.toEqual({ type: 'pong' });
      } finally {
        clearInterval(pings);
      }
    });

    it('logs a message by its type and size, never its content', async () => {
      const { cookie } = await pilot();
      const logger = app.get<PinoLogger>(getLoggerToken(RealtimeGateway.name));
      const debug = vi.spyOn(logger, 'debug');
      const client = await open(cookie);

      client.send({ type: 'visibility', visible: true });
      client.send({ type: 'ping' });
      await client.next('pong');

      const logged = debug.mock.calls.map(([fields]) => fields);
      expect(logged).toContainEqual({ direction: 'in', type: 'visibility', bytes: 36 });
      expect(logged).toContainEqual({ direction: 'in', type: 'ping', bytes: 15 });
      expect(JSON.stringify(debug.mock.calls)).not.toContain('"visible"');
    });
  });
});
