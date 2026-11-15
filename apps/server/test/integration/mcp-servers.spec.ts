import { type Event, type McpServers, zMcpServer, zMcpServerList, zState } from '@crewdeck/contracts';
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

type Servers = McpServers['servers'];

const STITCH: Servers[number] = { name: 'stitch', transport: 'stdio', state: 'ready', toolCount: 12 };
const FIGMA: Servers[number] = { name: 'figma', transport: 'http', state: 'ready', toolCount: 4 };

interface Tab {
  id: string;
  cookie: string;
}

describe('the Serveurs MCP against PostgreSQL', () => {
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

  const pilot = async (login = 'octocat'): Promise<Tab> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone, getting_started_step) VALUES ($1, $2, $3, 'Europe/Paris', 'done')`, [
      id,
      Math.floor(Math.random() * 1e9),
      login,
    ]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  const page = (tab: Tab | undefined, path: string): Promise<Response> =>
    fetch(`${url}${path}`, { headers: { ...(tab ? { cookie: tab.cookie } : {}), origin: ORIGIN } });

  const state = async (tab: Tab) => zState.parse(await (await page(tab, '/api/state')).json());

  const online = async (tab: Tab): Promise<FakeRunnerClient> => {
    const { token } = await createLinkedRunner(prisma, tab.id);
    const socket = await connectRunner(url, token);
    sockets.push(socket);
    socket.hello();
    await socket.expect('hello.accepted');
    return socket;
  };

  /** Sends `servers` and resolves with the `mcp-server` events they wrote, once `count` of them are published. */
  const report = async (tab: Tab, socket: FakeRunnerClient, servers: Servers, count: number): Promise<Event[]> => {
    const published: Event[] = [];
    const unsubscribe = app.get(EventsBus).subscribe(tab.id, (event) => published.push(event));
    try {
      socket.send({ type: 'mcp.servers', servers });
      await vi.waitFor(() => expect(published.filter((event) => event.type.startsWith('mcp-server.'))).toHaveLength(count), { timeout: 5_000 });
      return published;
    } finally {
      unsubscribe();
    }
  };

  const names = async (tab: Tab): Promise<string[]> => zMcpServerList.parse(await (await page(tab, '/api/mcp-servers')).json()).items.map((server) => server.name);

  describe('the mcp.servers message', () => {
    it('stores one row per server with mcp-server.upserted, in the same transaction', async () => {
      const alice = await pilot();
      const socket = await online(alice);

      const published = await report(alice, socket, [STITCH, FIGMA], 2);

      expect(published.map((event) => event.type)).toEqual(['mcp-server.upserted', 'mcp-server.upserted']);
      expect(published.map((event) => zMcpServer.parse(event.payload)).map(({ name, transport, state, toolCount }) => ({ name, transport, state, toolCount }))).toEqual([
        STITCH,
        FIGMA,
      ]);
      const [{ seq }] = (await sql<{ seq: string }>('SELECT seq FROM pilots WHERE id = $1', [alice.id])) as [{ seq: string }];
      expect(Number(seq)).toBe(published.at(-1)?.seq);
    });

    it('replaces the set: a removed server is deleted with mcp-server.removed, a changed one upserted, an unchanged one left alone', async () => {
      const alice = await pilot();
      const socket = await online(alice);
      const first = await report(alice, socket, [STITCH, FIGMA], 2);
      const figmaId = zMcpServer.parse(first[1]?.payload).id;
      const stitchId = zMcpServer.parse(first[0]?.payload).id;

      const published = await report(alice, socket, [{ ...STITCH, state: 'failed', toolCount: null }], 2);

      expect(published.map((event) => event.type).sort()).toEqual(['mcp-server.removed', 'mcp-server.upserted']);
      expect(published.find((event) => event.type === 'mcp-server.removed')?.payload).toEqual({ id: figmaId });
      expect(zMcpServer.parse(published.find((event) => event.type === 'mcp-server.upserted')?.payload)).toMatchObject({ id: stitchId, state: 'failed', toolCount: null });
      expect(await names(alice)).toEqual(['stitch']);

      const again = await report(alice, socket, [{ ...STITCH, state: 'failed', toolCount: null }, FIGMA], 1);
      expect(again.map((event) => event.type)).toEqual(['mcp-server.upserted']);
      expect(await names(alice)).toEqual(['figma', 'stitch']);
    });

    it('removes every row when the Runner reports none', async () => {
      const alice = await pilot();
      const socket = await online(alice);
      await report(alice, socket, [STITCH, FIGMA], 2);

      const published = await report(alice, socket, [], 2);

      expect(published.map((event) => event.type)).toEqual(['mcp-server.removed', 'mcp-server.removed']);
      expect(await names(alice)).toEqual([]);
    });

    it('keeps no secret: no column of mcp_servers is one, nor holds what a Runner would leak', async () => {
      const alice = await pilot();
      const socket = await online(alice);
      const leaky = { ...STITCH, command: 'npx stitch-mcp', env: { API_KEY: 's3cr3t' } } as unknown as Servers[number];

      await report(alice, socket, [leaky], 1);

      const columns = await sql<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'mcp_servers' ORDER BY column_name`);
      expect(columns.map((column) => column.column_name)).toEqual(['id', 'name', 'pilot_id', 'reported_at', 'state', 'tool_count', 'transport']);
      expect(JSON.stringify(await sql('SELECT * FROM mcp_servers WHERE pilot_id = $1', [alice.id]))).not.toContain('s3cr3t');
      expect(JSON.stringify(await sql('SELECT payload FROM events WHERE pilot_id = $1', [alice.id]))).not.toMatch(/s3cr3t|stitch-mcp/);
    });
  });

  describe('GET /api/mcp-servers', () => {
    it('lists the Pilote’s Serveurs MCP by name, as its schema says, and the mcp-server slice of the state the same', async () => {
      const alice = await pilot();
      await report(alice, await online(alice), [STITCH, FIGMA], 2);

      const res = await page(alice, '/api/mcp-servers');

      expect(res.status).toBe(200);
      const { items } = zMcpServerList.parse(await res.json());
      expect(items.map(({ name, transport, state, toolCount }) => ({ name, transport, state, toolCount }))).toEqual([FIGMA, STITCH]);
      expect((await state(alice))['mcp-server']).toEqual(items);
    });

    it('never returns another Pilote’s', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      await report(alice, await online(alice), [STITCH], 1);
      await report(bob, await online(bob), [FIGMA], 1);

      expect(await names(bob)).toEqual(['figma']);
      expect((await state(bob))['mcp-server'].map((server) => server.name)).toEqual(['figma']);
      expect(await names(alice)).toEqual(['stitch']);
    });

    it('answers 401 without a session', async () => {
      await expectEnvelope(await page(undefined, '/api/mcp-servers'), 401, 'auth.required');
    });
  });
});
