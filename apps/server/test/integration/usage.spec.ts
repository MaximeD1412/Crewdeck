import { type Capabilities, type Event, type Usage, zState, zUsageAccount, zUsageList } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { Transactions } from '../../src/realtime/transactions.js';
import { EventsBus } from '../../src/realtime/events.bus.js';
import { RunnerClock } from '../../src/runners/clock.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
import { FxRates } from '../../src/usage/fx.job.js';
import { UsageRetention } from '../../src/usage/usage.retention.js';
import { UsageService } from '../../src/usage/usage.service.js';
import { connectRunner, type FakeRunnerClient } from '../fakes/runner.js';
import { expectEnvelope, startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');
// The fakes: the ECB is a fake file, never the real one.
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl, CREWDECK_COMMIT: 'abc1234', CREWDECK_FAKES: '1' });
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

const FEATURES = { interrupt: true, resume: true, questions: true, permissions: true };
const ENGINES: Capabilities['engines'] = [
  { engine: 'claude-code', installed: true, version: '2.1.3', knownVersion: true, account: { kind: 'subscription', state: 'connected' }, models: [{ id: 'opus', label: 'Opus', usable: true }], features: FEATURES },
  { engine: 'codex', installed: true, version: '0.9.0', knownVersion: true, account: { kind: 'api-key', state: 'connected' }, models: [{ id: 'gpt', label: 'GPT', usable: true }], features: FEATURES },
];

const ECB = (day: string, rate: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope><Cube><Cube time='${day}'><Cube currency='USD' rate='${rate}'/><Cube currency='JPY' rate='163.25'/></Cube></Cube></gesmes:Envelope>`;

type UsageFields = Omit<Usage, 'type' | 'id' | 'at'>;

const claude = (measuredAt: string, fiveHour: number, week: number): UsageFields => ({
  engine: 'claude-code',
  accountKind: 'subscription',
  windows: [
    { id: 'five-hour', usedPercent: fiveHour, resetsAt: '2026-11-11T15:40:00.000Z' },
    { id: 'week', usedPercent: week, resetsAt: '2026-11-16T07:00:00.000Z' },
  ],
  measuredAt,
});

const codex = (measuredAt: string, costUsdMicros: number): UsageFields => ({
  engine: 'codex',
  accountKind: 'api-key',
  windows: [],
  spend: { costUsdMicros },
  measuredAt,
});

interface Tab {
  id: string;
  cookie: string;
}

describe('the usage of the Comptes IA against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let clock: RunnerClock;
  let fakes: Fakes;
  const sockets: FakeRunnerClient[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    prisma = app.get(PrismaService);
    clock = app.get(RunnerClock);
    fakes = app.get<Fakes>(FAKES);
  });

  afterAll(async () => {
    await sql('TRUNCATE pilots, fx_rates CASCADE');
    await app.close();
  });

  beforeEach(async () => {
    await sql('TRUNCATE pilots, fx_rates CASCADE');
    clock.now = () => new Date('2026-11-11T14:10:00.000Z');
    fakes.fx.reset();
  });

  afterEach(async () => {
    await Promise.all(sockets.splice(0).map((socket) => socket.close()));
  });

  const pilot = async (login = 'octocat', timeZone = 'Europe/Paris'): Promise<Tab> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone, getting_started_step) VALUES ($1, $2, $3, $4, 'done')`, [
      id,
      Math.floor(Math.random() * 1e9),
      login,
      timeZone,
    ]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  const page = (tab: Tab | undefined, path: string): Promise<Response> =>
    fetch(`${url}${path}`, { headers: { ...(tab ? { cookie: tab.cookie } : {}), origin: ORIGIN } });

  const usage = async (tab: Tab) => {
    const res = await page(tab, '/api/usage');
    expect(res.status).toBe(200);
    return zUsageList.parse(await res.json()).accounts;
  };

  /** Waits for `count` events of `type` on the Pilote's bus while `act` runs. */
  const published = async (tab: Tab, type: string, count: number, act: () => unknown): Promise<Event[]> => {
    const events: Event[] = [];
    const unsubscribe = app.get(EventsBus).subscribe(tab.id, (event) => events.push(event));
    try {
      await act();
      await vi.waitFor(() => expect(events.filter((event) => event.type === type)).toHaveLength(count), { timeout: 5_000 });
      return events.filter((event) => event.type === type);
    } finally {
      unsubscribe();
    }
  };

  /** The Pilote's Runner online, its Comptes IA reported. */
  const online = async (tab: Tab): Promise<FakeRunnerClient> => {
    const { token } = await createLinkedRunner(prisma, tab.id);
    const socket = await connectRunner(url, token);
    sockets.push(socket);
    socket.hello();
    await socket.expect('hello.accepted');
    await published(tab, 'ai-account.upserted', ENGINES.length, () => socket.send({ type: 'capabilities', engines: ENGINES }));
    return socket;
  };

  const send = async (tab: Tab, socket: FakeRunnerClient, ...messages: UsageFields[]): Promise<Event[]> =>
    published(tab, 'usage.upserted', messages.length, () => {
      for (const message of messages) socket.send({ type: 'usage', ...message });
    });

  const rate = (day: string, usdPerEur: string) => sql(`INSERT INTO fx_rates (day, usd_per_eur, fetched_at) VALUES ($1, $2, now())`, [day, usdPerEur]);

  describe('the usage message', () => {
    it('stores the windows’ measures with usage.upserted, in the same transaction', async () => {
      const alice = await pilot();
      const socket = await online(alice);

      const [event] = await send(alice, socket, claude('2026-11-11T14:09:00.000Z', 100, 62));

      const account = zUsageAccount.parse(event?.payload);
      expect(account).toMatchObject({ engine: 'claude-code', kind: 'subscription', measuredAt: '2026-11-11T14:09:00.000Z' });
      expect(account.windows).toEqual([
        { id: 'five-hour', usedPercent: 100, resetsAt: '2026-11-11T15:40:00.000Z', holdsUntilReset: false, measuredAt: '2026-11-11T14:09:00.000Z' },
        { id: 'week', usedPercent: 62, resetsAt: '2026-11-16T07:00:00.000Z', holdsUntilReset: false, measuredAt: '2026-11-11T14:09:00.000Z' },
      ]);
      const rows = await sql<{ window: string; used_percent: number }>('SELECT "window", used_percent FROM usage_measures WHERE pilot_id = $1 ORDER BY "window"', [alice.id]);
      expect(rows).toEqual([
        { window: 'five-hour', used_percent: 100 },
        { window: 'week', used_percent: 62 },
      ]);
      const [{ seq }] = (await sql<{ seq: string }>('SELECT seq FROM pilots WHERE id = $1', [alice.id])) as [{ seq: string }];
      expect(Number(seq)).toBe(event?.seq);
    });

    it('stores an API key’s spend in micro-dollars and in euro cents at the day’s rate', async () => {
      const alice = await pilot();
      const socket = await online(alice);
      await rate('2026-11-10', '1.0842');

      const [event] = await send(alice, socket, codex('2026-11-11T14:09:00.000Z', 23_418_720));

      expect(zUsageAccount.parse(event?.payload)).toMatchObject({ engine: 'codex', kind: 'api-key', windows: [], monthSpend: { costUsdMicros: 23_418_720, costEurCents: 2160, endsAt: '2026-11-30T23:00:00.000Z' } });
      const rows = await sql<{ day: string; cost_usd_micros: string; cost_eur_cents: string; project_id: null }>(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, cost_usd_micros, cost_eur_cents, project_id FROM spends WHERE pilot_id = $1`,
        [alice.id],
      );
      expect(rows).toEqual([{ day: '2026-11-11', cost_usd_micros: '23418720', cost_eur_cents: '2160', project_id: null }]);
    });

    it('keeps the Session a spend is of', async () => {
      const alice = await pilot();
      const socket = await online(alice);
      const sessionId = newId();

      await send(alice, socket, { ...codex('2026-11-11T14:09:00.000Z', 1_000), spend: { sessionId, costUsdMicros: 1_000 } });

      expect(await sql('SELECT session_id FROM spends WHERE pilot_id = $1', [alice.id])).toEqual([{ session_id: sessionId }]);
    });

    it('stores once a spend the Runner sends again, without usage.upserted the second time', async () => {
      const alice = await pilot();
      await online(alice);
      const message: Usage = { type: 'usage', id: newId(), at: '2026-11-11T14:09:01.000Z', ...codex('2026-11-11T14:09:00.000Z', 1_000) };
      const record = () => runInPilotScope(alice.id, () => app.get(UsageService).record(alice.id, message));

      await published(alice, 'usage.upserted', 1, record);
      const events: Event[] = [];
      const unsubscribe = app.get(EventsBus).subscribe(alice.id, (event) => events.push(event));
      await record();
      unsubscribe();

      expect(await sql('SELECT cost_usd_micros FROM spends WHERE pilot_id = $1', [alice.id])).toEqual([{ cost_usd_micros: '1000' }]);
      expect(events).toEqual([]);
    });

    it('acks a usage once its transaction is committed, and a spend stored already too', async () => {
      const alice = await pilot();
      const socket = await online(alice);
      const id = newId();
      const message = JSON.stringify({ type: 'usage', id, at: '2026-11-11T14:09:01.000Z', ...codex('2026-11-11T14:09:00.000Z', 1_000) });

      socket.send(message);
      expect((await socket.expect('usage.ack')).usageId).toBe(id);
      expect(await sql('SELECT cost_usd_micros FROM spends WHERE id = $1', [id])).toEqual([{ cost_usd_micros: '1000' }]);
      socket.send(message);
      expect((await socket.expect('usage.ack')).usageId).toBe(id);
      expect(await sql('SELECT id FROM spends WHERE pilot_id = $1', [alice.id])).toHaveLength(1);
    });

    it('does not ack a usage its transaction failed to store: the Runner sends it again', async () => {
      const alice = await pilot();
      const { token } = await createLinkedRunner(prisma, alice.id);
      const connect = async () => {
        const socket = await connectRunner(url, token);
        sockets.push(socket);
        socket.hello();
        await socket.expect('hello.accepted');
        return socket;
      };
      const socket = await connect();
      const id = newId();
      const message = JSON.stringify({ type: 'usage', id, at: '2026-11-11T14:09:01.000Z', ...codex('2026-11-11T14:09:00.000Z', 1_000) });
      const failure = vi.spyOn(app.get(Transactions), 'run').mockRejectedValueOnce(new Error('the database is down'));

      socket.send(message);
      await socket.closed();
      failure.mockRestore();
      expect(socket.received().filter((received) => received.type === 'usage.ack')).toEqual([]);
      expect(await sql('SELECT id FROM spends WHERE pilot_id = $1', [alice.id])).toEqual([]);

      const again = await connect();
      again.send(message);
      expect((await again.expect('usage.ack')).usageId).toBe(id);
      expect(await sql('SELECT id FROM spends WHERE pilot_id = $1', [alice.id])).toEqual([{ id }]);
    });

    it('keeps no spend for a subscription: its cost is a share of its windows', async () => {
      const alice = await pilot();
      const socket = await online(alice);

      await send(alice, socket, { ...claude('2026-11-11T14:09:00.000Z', 40, 62), spend: { costUsdMicros: 1_000_000 } });

      expect(await sql('SELECT id FROM spends WHERE pilot_id = $1', [alice.id])).toEqual([]);
      expect((await usage(alice))[0]?.monthSpend).toBeUndefined();
    });
  });

  describe('GET /api/usage', () => {
    it('lists each Compte IA’s usage, as its schema says, and the usage slice of the state the same', async () => {
      const alice = await pilot();
      const socket = await online(alice);
      await rate('2026-11-10', '1.0842');
      await send(alice, socket, claude('2026-11-11T14:09:00.000Z', 100, 62), codex('2026-11-11T14:09:30.000Z', 23_418_720));

      const accounts = await usage(alice);

      expect(accounts.map(({ engine, kind }) => ({ engine, kind }))).toEqual([
        { engine: 'claude-code', kind: 'subscription' },
        { engine: 'codex', kind: 'api-key' },
      ]);
      const ids = await sql<{ id: string }>('SELECT id FROM ai_accounts WHERE pilot_id = $1 ORDER BY engine', [alice.id]);
      expect(accounts.map((account) => account.id)).toEqual(ids.map((row) => row.id));
      const state = zState.parse(await (await page(alice, '/api/state')).json());
      expect(state.usage).toEqual(accounts);
    });

    it('projects each window at the pace of its last 24 hours', async () => {
      const alice = await pilot();
      const socket = await online(alice);
      // The week: 2 % an hour from 04:00 to 14:00, 62 % used, runs out Thursday 09:00 UTC, before Monday’s reset.
      await send(alice, socket, claude('2026-11-11T04:00:00.000Z', 10, 42), claude('2026-11-11T09:00:00.000Z', 30, 52), claude('2026-11-11T14:00:00.000Z', 100, 62));
      clock.now = () => new Date('2026-11-11T14:00:00.000Z');

      const [account] = await usage(alice);

      expect(account?.windows.find((window) => window.id === 'week')).toMatchObject({ usedPercent: 62, exhaustsAt: '2026-11-12T09:00:00.000Z', holdsUntilReset: false, projectedPercent: 100 });
      expect(account?.windows.find((window) => window.id === 'five-hour')).toMatchObject({ usedPercent: 100, holdsUntilReset: false });
      expect(account?.windows.find((window) => window.id === 'five-hour')?.exhaustsAt).toBeUndefined();
      expect(account?.windows.find((window) => window.id === 'five-hour')?.projectedPercent).toBeUndefined();
    });

    it('drops a window whose reset has passed, until its next measure', async () => {
      const alice = await pilot();
      const socket = await online(alice);
      await send(alice, socket, claude('2026-11-11T14:09:00.000Z', 100, 62));
      clock.now = () => new Date('2026-11-11T16:00:00.000Z');

      const [account] = await usage(alice);

      expect(account?.windows.map((window) => window.id)).toEqual(['week']);
    });

    it('sums the spends of the current month in the Pilote’s time zone, and says when it ends there', async () => {
      const alice = await pilot();
      const socket = await online(alice);
      await rate('2026-11-01', '1');
      // 23:30 UTC on the last day of November is December 1st in Paris.
      await send(alice, socket, codex('2026-11-30T23:30:00.000Z', 5_000_000), codex('2026-12-01T09:00:00.000Z', 2_000_000), codex('2026-11-30T21:00:00.000Z', 1_000_000));
      clock.now = () => new Date('2026-12-01T10:00:00.000Z');

      const [account] = await usage(alice);

      expect(account?.monthSpend).toEqual({ costUsdMicros: 7_000_000, costEurCents: 700, endsAt: '2026-12-31T23:00:00.000Z' });
    });

    it('never returns another Pilote’s', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const socket = await online(alice);
      await send(alice, socket, claude('2026-11-11T14:09:00.000Z', 100, 62), codex('2026-11-11T14:09:30.000Z', 1_000_000));

      expect(await usage(bob)).toEqual([]);
      expect(zState.parse(await (await page(bob, '/api/state')).json()).usage).toEqual([]);
    });

    it('answers 401 without a session', async () => {
      await expectEnvelope(await page(undefined, '/api/usage'), 401, 'auth.required');
    });
  });

  describe('the rates of the ECB', () => {
    it('stores the day’s rate from the ECB’s file', async () => {
      fakes.fx.xml = ECB('2026-11-13', '1.0842');

      await app.get(FxRates).refresh();

      expect(await sql(`SELECT to_char(day, 'YYYY-MM-DD') AS day, usd_per_eur::text FROM fx_rates`)).toEqual([{ day: '2026-11-13', usd_per_eur: '1.084200' }]);
    });

    it('converts, with usage.upserted, the spends stored before any rate was known', async () => {
      const alice = await pilot();
      const socket = await online(alice);
      await send(alice, socket, codex('2026-11-11T14:09:00.000Z', 23_418_720));
      expect((await usage(alice))[0]?.monthSpend).toEqual({ costUsdMicros: 23_418_720, costEurCents: null, endsAt: '2026-11-30T23:00:00.000Z' });
      fakes.fx.xml = ECB('2026-11-11', '1.0842');

      const [event] = await published(alice, 'usage.upserted', 1, () => app.get(FxRates).refresh());

      expect(zUsageAccount.parse(event?.payload).monthSpend).toEqual({ costUsdMicros: 23_418_720, costEurCents: 2160, endsAt: '2026-11-30T23:00:00.000Z' });
    });

    it('keeps what it had when the file cannot be read', async () => {
      await rate('2026-11-10', '1.0842');
      fakes.fx.xml = '<html>maintenance</html>';

      await expect(app.get(FxRates).refresh()).rejects.toThrow(/ECB/);

      expect(await sql(`SELECT usd_per_eur::text FROM fx_rates`)).toEqual([{ usd_per_eur: '1.084200' }]);
    });
  });

  describe('the retention', () => {
    it('deletes the measures older than 30 days', async () => {
      const alice = await pilot();
      const socket = await online(alice);
      await send(alice, socket, claude('2026-10-01T10:00:00.000Z', 10, 20), claude('2026-11-11T14:09:00.000Z', 100, 62));

      await app.get(UsageRetention).purge(new Date('2026-11-11T15:00:00.000Z'));

      const rows = await sql<{ measured_at: Date }>('SELECT measured_at FROM usage_measures WHERE pilot_id = $1', [alice.id]);
      expect(rows.map((row) => row.measured_at.toISOString())).toEqual(['2026-11-11T14:09:00.000Z', '2026-11-11T14:09:00.000Z']);
    });
  });
});
