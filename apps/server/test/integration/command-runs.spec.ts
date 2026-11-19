import type { INestApplication } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { type CommandRunFinished, CommandRunHooks, type CommandRunStarted } from '../../src/commands/command-run-hooks.js';
import { type CommandRunRequest, CommandRuns } from '../../src/commands/command-runs.service.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { FakeRunner } from '../../src/testing/fake-runner.js';
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
const SEALED = { key: bytes(0xe1, 60), ciphertext: bytes(0xe2, 80) };
const WORKTREE_COMMANDS = { key: bytes(0xf1, 60), ciphertext: bytes(0xf2, 48) };
const SECRETS = [WRAP.enc, WRAP.wrappedKey, FRAME.nonce, FRAME.ciphertext, LIVE.nonce, LIVE.ciphertext, SEALED.key, SEALED.ciphertext];

/** The SQL statements a client of `pg` (Prisma's adapter among them) sends from now on. */
const spyQueries = () => {
  const spy = vi.spyOn(pg.Client.prototype, 'query');
  const all = (): string[] => spy.mock.calls.map(([query]) => (typeof query === 'string' ? query : ((query as { text?: string }).text ?? '')));
  return {
    writes: () => all().filter((text) => /^\s*(insert|update|delete|merge|upsert)\b/i.test(text)),
    stop: () => spy.mockRestore(),
  };
};

const request = (runId: string): CommandRunRequest => ({
  runId,
  projectId: newId(),
  commandId: 'cmd-tests',
  sealed: SEALED,
  origin: { kind: 'github', owner: 'acme', name: 'shop' },
  integrationBranch: 'develop',
  ref: { stepId: 'tests', ticket: 12, branch: 'feat/12-panier', sha: '3f786850e387550fdab836ed7e6dc881de23001b' },
});

describe('the Commandes run on the Runner, against PostgreSQL', () => {
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

  /** A Pilote: their cookie and their Runner's token. */
  const pilot = async (login: string): Promise<{ id: string; cookie: string; token: string }> => {
    const id = newId();
    await sql(`WITH p AS (INSERT INTO pilots (id, display_name, time_zone, getting_started_step) VALUES ($1, $3, 'Europe/Paris', 'done') RETURNING id) INSERT INTO pilot_identities (id, pilot_id, provider, subject, login) SELECT gen_random_uuid(), id, 'github', $2::text, $3 FROM p`, [
      id,
      Math.floor(Math.random() * 1e9),
      login,
    ]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    const runner = await createLinkedRunner(prisma, id);
    return { id, cookie: `${SESSION_COOKIE}=${token}`, token: runner.token };
  };

  /** A Projet `acme/shop` of the Pilote `pilotId`. */
  const project = async (pilotId: string): Promise<string> => {
    const id = newId();
    await sql(
      `INSERT INTO projects (id, pilot_id, repository_id, github_repo_id, owner, name, full_name, display_name, release_branch, integration_branch, has_code, inventory_state)
       VALUES ($1, $2, $3, $4, 'acme', 'shop', 'acme/shop', 'shop', 'main', 'develop', true, 'not-needed')`,
      [id, pilotId, newId(), Math.floor(Math.random() * 1e9)],
    );
    return id;
  };

  const tab = async (cookie: string): Promise<WsClient> => {
    const client = await connect(url, { cookie, origin: ORIGIN });
    closers.push(client);
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

  const hooks = () => {
    const started: CommandRunStarted[] = [];
    const finished: CommandRunFinished[] = [];
    const removals = [
      app.get(CommandRunHooks).onStarted((event) => {
        started.push(event);
      }),
      app.get(CommandRunHooks).onFinished((event) => {
        finished.push(event);
      }),
    ];
    return { started, finished, remove: () => removals.forEach((remove) => remove()) };
  };

  it('sends command.run to the Pilote’s Runner, gives its reports to the hooks, and relays its output to the tab that opened it, writing and logging none of it', async () => {
    const alice = await pilot('alice');
    const runner = await online(alice);
    const opener = await tab(alice.cookie);
    const other = await tab(alice.cookie);
    const heard = hooks();
    const runId = newId();
    const queries = spyQueries();

    try {
      await app.get(CommandRuns).send(alice.id, request(runId));
      expect(await runner.expect('command.run')).toMatchObject({ runId, commandId: 'cmd-tests', sealed: SEALED, worktreeCommands: null });

      opener.send({ type: 'command.open', runId, fromSeq: 1 });
      const replay = await runner.expect('command.replay');
      expect(replay).toMatchObject({ runId, fromSeq: 1, tabId: expect.any(String) });
      runner.send({ type: 'command.started', runId });
      runner.send({ type: 'command.keys', runId, tabId: replay.tabId, wraps: [WRAP] });
      runner.send({ type: 'command.output', runId, tabId: replay.tabId, seq: 1, ...FRAME });
      runner.send({ type: 'command.output', runId, seq: 2, ...LIVE });
      runner.send({ type: 'command.verdict', runId, passed: false, exitCode: 3, reason: 'exited', durationMs: 4200 });

      expect(await opener.next('command.keys')).toEqual({ type: 'command.keys', runId, wraps: [WRAP] });
      expect(await opener.next('command.output')).toEqual({ type: 'command.output', runId, seq: 1, ...FRAME });
      expect(await opener.next('command.output')).toEqual({ type: 'command.output', runId, seq: 2, ...LIVE });
      await vi.waitFor(() => expect(heard.finished).toEqual([{ pilotId: alice.id, runId, passed: false, exitCode: 3, reason: 'exited', durationMs: 4200 }]));
      expect(heard.started).toEqual([{ pilotId: alice.id, runId }]);

      other.send({ type: 'ping' });
      await other.next('pong');
      expect(other.collect().map((message) => message.type)).toEqual(['pong', 'pong']);
      expect(queries.writes()).toEqual([]);
    } finally {
      queries.stop();
      heard.remove();
    }

    const output = lines.join('');
    for (const secret of SECRETS) expect(output).not.toContain(secret);
    const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logged).toContainEqual(expect.objectContaining({ msg: 'command relay', type: 'command.output', runId }));
  });

  it('carries the Projet’s worktree Commandes sealed as stored, read in the Pilote’s scope, writing nothing', async () => {
    const alice = await pilot('alice');
    const bob = await pilot('bob');
    const runner = await online(alice);
    const projectId = await project(alice.id);
    await sql(`INSERT INTO project_settings (project_id, pilot_id, roles, worktree_commands, updated_at) VALUES ($1, $2, '{}', $3, now())`, [projectId, alice.id, WORKTREE_COMMANDS]);
    const runId = newId();
    const queries = spyQueries();

    try {
      await app.get(CommandRuns).send(alice.id, { ...request(runId), projectId });
      expect(await runner.expect('command.run')).toMatchObject({ runId, projectId, worktreeCommands: WORKTREE_COMMANDS });
      expect(queries.writes()).toEqual([]);
    } finally {
      queries.stop();
    }
    // Another Pilote's Projet: its Paramètres are not theirs to send.
    const bobsRunner = await online(bob);
    const other = newId();
    await app.get(CommandRuns).send(bob.id, { ...request(other), projectId });
    expect(await bobsRunner.expect('command.run')).toMatchObject({ runId: other, worktreeCommands: null });
    expect(lines.join('')).not.toContain(WORKTREE_COMMANDS.ciphertext);
  });

  it('answers command.not-found to the open of another Pilote’s run, and command.runner-offline while the Runner is away, asking its replay once back', async () => {
    const alice = await pilot('alice');
    const bob = await pilot('bob');
    const bobsRunner = await online(bob);
    const runId = newId();
    await app.get(CommandRuns).send(bob.id, request(runId));
    await bobsRunner.expect('command.run');
    const client = await tab(alice.cookie);

    client.send({ type: 'command.open', runId, fromSeq: 1 });
    expect(await client.next('command.error')).toEqual({ type: 'command.error', runId, code: 'command.not-found' });

    const bobsTab = await tab(bob.cookie);
    await bobsRunner.close();
    bobsTab.send({ type: 'command.open', runId, fromSeq: 2 });
    expect(await bobsTab.next('command.error')).toEqual({ type: 'command.error', runId, code: 'command.runner-offline' });
    const back = await online(bob);
    expect(await back.expect('command.replay')).toMatchObject({ runId, fromSeq: 2, tabId: expect.any(String) });
  });

  it('throws runner.offline when the Pilote’s Runner is away', async () => {
    const alice = await pilot('alice');

    await expect(app.get(CommandRuns).send(alice.id, request(newId()))).rejects.toThrow(expect.objectContaining({ status: 422, code: 'runner.offline' }));
  });

  describe('the fake Runner of pnpm dev', () => {
    it('answers command.run with started, two chunks and the verdict the scenario sets, and replays the chunks to a tab', async () => {
      const alice = await pilot('alice');
      const fake = new FakeRunner();
      const heard = hooks();
      try {
        await fake.connect(url, alice.token);
        const passing = newId();
        await app.get(CommandRuns).send(alice.id, request(passing));
        await vi.waitFor(() => expect(heard.finished).toEqual([{ pilotId: alice.id, runId: passing, passed: true, exitCode: 0, reason: 'exited', durationMs: 1200 }]));

        fake.endCommandsWith({ reason: 'timeout' });
        const late = newId();
        await app.get(CommandRuns).send(alice.id, request(late));
        await vi.waitFor(() => expect(heard.finished.at(-1)).toEqual({ pilotId: alice.id, runId: late, passed: false, exitCode: null, reason: 'timeout', durationMs: 1200 }));
        expect(heard.started.map((event) => event.runId)).toEqual([passing, late]);

        const client = await tab(alice.cookie);
        client.send({ type: 'command.open', runId: late, fromSeq: 1 });
        expect(await client.next('command.output')).toMatchObject({ runId: late, seq: 1 });
        expect(await client.next('command.output')).toMatchObject({ runId: late, seq: 2 });
      } finally {
        heard.remove();
        fake.reset();
      }
    });
  });
});
