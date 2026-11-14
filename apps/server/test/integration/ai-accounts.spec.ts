import { type Capabilities, type Event, zAiAccount, zAiAccountList, zMe, zState } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { EventsBus } from '../../src/realtime/events.bus.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
import { connectRunner, type FakeRunnerClient } from '../fakes/runner.js';
import { expectEnvelope, startApp } from '../route-baseline.js';

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

type Engines = Capabilities['engines'];

const FEATURES = { interrupt: true, resume: true, questions: true, permissions: true };

/** Claude Code by subscription with Opus usable and Fable outside the plan; Codex without a key. */
const ENGINES: Engines = [
  {
    engine: 'claude-code',
    installed: true,
    version: '2.1.3',
    knownVersion: true,
    account: { kind: 'subscription', state: 'connected' },
    models: [
      { id: 'opus', label: 'Opus', usable: true },
      { id: 'fable', label: 'Fable', usable: false, reason: 'not-in-plan' },
    ],
    features: FEATURES,
  },
  { engine: 'codex', installed: true, version: '0.9.0', knownVersion: false, account: { kind: 'none', state: 'login-required' }, models: [], features: FEATURES },
];

/** Nothing a Rôle can run on: Claude Code signed out. */
const NONE_USABLE: Engines = [
  {
    engine: 'claude-code',
    installed: true,
    version: '2.1.3',
    knownVersion: true,
    account: { kind: 'none', state: 'login-required' },
    models: [{ id: 'opus', label: 'Opus', usable: false, reason: 'login-required' }],
    features: FEATURES,
  },
];

interface Tab {
  id: string;
  cookie: string;
}

describe('the Comptes IA against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  const sockets: FakeRunnerClient[] = [];

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
    await Promise.all(sockets.splice(0).map((socket) => socket.close()));
  });

  const pilot = async (login = 'octocat', step = 'ai-accounts'): Promise<Tab> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, display_name, time_zone, getting_started_step) VALUES ($1, $2, 'Europe/Paris', $3)`, [
      id,
      login,
      step,
    ]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  const page = (tab: Tab | undefined, path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(tab ? { cookie: tab.cookie } : {}), origin: ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const state = async (tab: Tab) => zState.parse(await (await page(tab, '/api/state')).json());

  /** The Pilote's Runner, online, as `crewdeck-runner run` leaves it. */
  const online = async (tab: Tab): Promise<FakeRunnerClient> => {
    const { token } = await createLinkedRunner(prisma, tab.id);
    const socket = await connectRunner(url, token);
    sockets.push(socket);
    socket.hello();
    await socket.expect('hello.accepted');
    return socket;
  };

  /** Sends `engines` and resolves with the `ai-account.upserted` events they wrote. */
  const report = async (tab: Tab, socket: FakeRunnerClient, engines: Engines): Promise<Event[]> => {
    const published: Event[] = [];
    const unsubscribe = app.get(EventsBus).subscribe(tab.id, (event) => published.push(event));
    try {
      socket.send({ type: 'capabilities', engines });
      await vi.waitFor(() => expect(published.filter((event) => event.type === 'ai-account.upserted')).toHaveLength(engines.length), { timeout: 5_000 });
      return published;
    } finally {
      unsubscribe();
    }
  };

  describe('the capabilities message', () => {
    it('stores one row per Moteur with ai-account.upserted, in the same transaction', async () => {
      const alice = await pilot();
      const socket = await online(alice);

      const published = await report(alice, socket, ENGINES);

      const accounts = published.map((event) => zAiAccount.parse(event.payload));
      expect(accounts.map(({ engine, kind, state }) => ({ engine, kind, state }))).toEqual([
        { engine: 'claude-code', kind: 'subscription', state: 'connected' },
        { engine: 'codex', kind: 'none', state: 'login-required' },
      ]);
      expect(accounts[0]?.models).toEqual(ENGINES[0]?.models);
      const [{ seq }] = (await sql<{ seq: string }>('SELECT seq FROM pilots WHERE id = $1', [alice.id])) as [{ seq: string }];
      expect(Number(seq)).toBe(published.at(-1)?.seq);
    });

    it('updates the Moteur’s row on the next report, never a second one', async () => {
      const alice = await pilot();
      const socket = await online(alice);
      await report(alice, socket, ENGINES);

      await report(alice, socket, NONE_USABLE);

      const rows = await sql<{ engine: string; state: string }>('SELECT engine, state FROM ai_accounts WHERE pilot_id = $1 ORDER BY engine', [alice.id]);
      expect(rows).toEqual([
        { engine: 'claude-code', state: 'login-required' },
        { engine: 'codex', state: 'login-required' },
      ]);
    });

    it('keeps no credential: no column of ai_accounts is one, nor holds the key a Runner would leak', async () => {
      const alice = await pilot();
      const socket = await online(alice);
      const leaky = { ...ENGINES[1], account: { kind: 'api-key', state: 'connected', apiKey: 'sk-secret' } } as unknown as Engines[number];

      await report(alice, socket, [ENGINES[0] as Engines[number], leaky]);

      const columns = await sql<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_accounts' ORDER BY column_name`);
      expect(columns.map((column) => column.column_name)).toEqual([
        'engine',
        'id',
        'installed',
        'kind',
        'known_version',
        'models',
        'pilot_id',
        'reported_at',
        'state',
        'version',
      ]);
      const rows = await sql<Record<string, unknown>>('SELECT * FROM ai_accounts WHERE pilot_id = $1', [alice.id]);
      expect(JSON.stringify(rows)).not.toContain('sk-secret');
      expect(JSON.stringify(await sql('SELECT payload FROM events WHERE pilot_id = $1', [alice.id]))).not.toContain('sk-secret');
    });
  });

  describe('GET /api/ai-accounts', () => {
    it('lists the Pilote’s Comptes IA, as its schema says, and the ai-account slice of the state the same', async () => {
      const alice = await pilot();
      await report(alice, await online(alice), ENGINES);

      const res = await page(alice, '/api/ai-accounts');

      expect(res.status).toBe(200);
      const { items } = zAiAccountList.parse(await res.json());
      expect(items.map((account) => account.engine)).toEqual(['claude-code', 'codex']);
      expect(items[1]).toMatchObject({ version: '0.9.0', knownVersion: false, models: [] });
      expect((await state(alice))['ai-account']).toEqual(items);
    });

    it('never returns another Pilote’s', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      await report(alice, await online(alice), ENGINES);

      expect(zAiAccountList.parse(await (await page(bob, '/api/ai-accounts')).json())).toEqual({ items: [] });
      expect((await state(bob))['ai-account']).toEqual([]);
    });

    it('answers 401 without a session', async () => {
      await expectEnvelope(await page(undefined, '/api/ai-accounts'), 401, 'auth.required');
    });
  });

  describe('POST /api/me/getting-started/advance from ai-accounts', () => {
    it('answers 422 getting-started.no-usable-engine without a usable model', async () => {
      const alice = await pilot();
      const socket = await online(alice);
      await report(alice, socket, NONE_USABLE);

      const res = await page(alice, '/api/me/getting-started/advance', { from: 'ai-accounts', seq: (await state(alice)).seq });

      const envelope = await expectEnvelope(res, 422, 'getting-started.no-usable-engine');
      expect(envelope.message).toBe('Connecte au moins un Compte IA utilisable.');
    });

    it('moves on to projects once a model is usable', async () => {
      const alice = await pilot();
      await report(alice, await online(alice), ENGINES);

      const res = await page(alice, '/api/me/getting-started/advance', { from: 'ai-accounts', seq: (await state(alice)).seq });

      expect(res.status).toBe(200);
      expect(zMe.parse(await res.json())).toMatchObject({ gettingStartedStep: 'projects' });
    });
  });
});
