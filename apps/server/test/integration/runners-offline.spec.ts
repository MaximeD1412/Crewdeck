import { type Event, parseWaitingProjects, type WaitingProject, zDecisionList } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { EventsBus } from '../../src/realtime/events.bus.js';
import { EventsWriter } from '../../src/realtime/events.writer.js';
import { Transactions } from '../../src/realtime/transactions.js';
import { RunnerClock } from '../../src/runners/clock.js';
import { RunnerOffline } from '../../src/runners/runner-offline.service.js';
import { OFFLINE_AFTER_MS, RunnerPresence } from '../../src/runners/runner-presence.service.js';
import { RunnerWaitingWork } from '../../src/runners/waiting-work.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
import { connectRunner, type FakeRunnerClient } from '../fakes/runner.js';
import { startApp } from '../route-baseline.js';

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

const CREWDECK: WaitingProject = { projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a01', name: 'Crewdeck', items: [{ kind: 'ticket-in-progress', number: 44 }] };
const PERSONAL_OS: WaitingProject = {
  projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02',
  name: 'Personal OS',
  items: [
    { kind: 'ticket-in-progress', number: 53 },
    { kind: 'tickets-ready', count: 2 },
  ],
};
const SITE_MAIRIE: WaitingProject = { projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a03', name: 'Site mairie', items: [{ kind: 'ticket-interrupted', number: 47 }] };

interface DecisionRow {
  id: string;
  state: string;
  outcome: string | null;
  subject_type: string;
  subject_id: string;
  label: string;
  meta_parts: string[];
  tone: string;
  link: string;
  params: Record<string, string>;
}

/** « Runner hors ligne » (ATOI-3): the presence of RUNNER-2, the waiting work's registry and the Décisions of ATOI-1. */
describe('« Runner hors ligne » against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let clock: RunnerClock;
  /** What the test provider declares, by Pilote. */
  const waiting = new Map<string, WaitingProject[]>();
  const runners: FakeRunnerClient[] = [];
  const published: Event[] = [];
  const unsubscribes: (() => void)[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    prisma = app.get(PrismaService);
    clock = app.get(RunnerClock);
    unsubscribes.push(app.get(RunnerWaitingWork).register({ key: 'test', projectsWaiting: (pilotId) => Promise.resolve(waiting.get(pilotId) ?? []) }));
  });

  afterAll(async () => {
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    await sql('TRUNCATE pilots CASCADE');
    await app.close();
  });

  beforeEach(() => sql('TRUNCATE pilots CASCADE'));

  afterEach(async () => {
    await Promise.all(runners.splice(0).map((runner) => runner.close()));
    clock.now = () => new Date();
    waiting.clear();
    published.length = 0;
  });

  /** A Pilote with a session, whose published events land in `published`. */
  const pilot = async (): Promise<{ id: string; cookie: string }> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone) VALUES ($1, $2, 'octocat', 'Europe/Paris')`, [id, Math.floor(Math.random() * 1e9)]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    const unsubscribe = app.get(EventsBus).subscribe(id, (event) => published.push(event));
    unsubscribes.push(unsubscribe);
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  /** A Runner linked to `pilotId`, its socket open and its `hello` accepted. */
  const online = async (pilotId: string) => {
    const { runner, token } = await createLinkedRunner(prisma, pilotId);
    const socket = await connectRunner(url, token);
    runners.push(socket);
    socket.hello();
    await socket.expect('hello.accepted');
    return { runner, token, socket };
  };

  const decisionsOf = (pilotId: string): Promise<DecisionRow[]> =>
    sql(
      `SELECT id, state, outcome, subject_type, subject_id, label, meta_parts, tone, link, params FROM decisions WHERE pilot_id = $1 AND kind = 'runner-offline' ORDER BY created_at, id`,
      [pilotId],
    );

  const decisionEvents = () => published.filter((event) => event.type.startsWith('decision.')).map((event) => event.type);

  it('raises one Décision listing the Projets whose work waits, within 2 s of the 45 s without a heartbeat, in « À toi »', async () => {
    const alice = await pilot();
    waiting.set(alice.id, [PERSONAL_OS, CREWDECK, SITE_MAIRIE]);
    const { runner } = await online(alice.id);
    const lastSeenAt = (await sql<{ last_seen_at: Date }>('SELECT last_seen_at FROM runners WHERE id = $1', [runner.id]))[0]?.last_seen_at;
    expect(await decisionsOf(alice.id)).toEqual([]);

    // The 45 s without a heartbeat are over: the sweep's own interval does the rest.
    const timeout = Date.now();
    clock.now = () => new Date((lastSeenAt?.getTime() ?? 0) + OFFLINE_AFTER_MS + 1);
    await vi.waitFor(async () => expect(await decisionsOf(alice.id)).toHaveLength(1), { timeout: 2_000, interval: 50 });
    expect(Date.now() - timeout).toBeLessThan(2_000);

    const [decision] = await decisionsOf(alice.id);
    expect(decision).toMatchObject({
      state: 'open',
      subject_type: 'runner',
      subject_id: runner.id,
      label: 'Le travail attend dans 3 Projets',
      meta_parts: ['3 Projets'],
      tone: 'halt',
      link: '/runner',
    });
    expect(decision?.params['since']).toBe(lastSeenAt?.toISOString());
    expect(parseWaitingProjects(decision?.params['projects'])).toEqual([CREWDECK, PERSONAL_OS, SITE_MAIRIE]);
    expect(decisionEvents()).toEqual(['decision.upserted']);

    const res = await fetch(`${url}/api/decisions?state=open`, { headers: { cookie: alice.cookie } });
    expect(zDecisionList.parse(await res.json()).items).toEqual([expect.objectContaining({ id: decision?.id, kind: 'runner-offline', label: 'Le travail attend dans 3 Projets' })]);
  });

  it('raises none when no provider declares work: the Runner is only « hors ligne »', async () => {
    const alice = await pilot();
    const { runner, socket } = await online(alice.id);

    await socket.close();
    await vi.waitFor(() => expect(app.get(RunnerPresence).isOnline(alice.id)).toBe(false));
    await app.get(RunnerOffline).refresh(alice.id);

    expect((await sql<{ state: string }>('SELECT state FROM runners WHERE id = $1', [runner.id]))[0]?.state).toBe('offline');
    expect(await decisionsOf(alice.id)).toEqual([]);
    expect(decisionEvents()).toEqual([]);
  });

  it('updates the same Décision on refresh while offline, with the new Projet', async () => {
    const alice = await pilot();
    waiting.set(alice.id, [CREWDECK]);
    const { socket } = await online(alice.id);
    await socket.close();
    await vi.waitFor(async () => expect(await decisionsOf(alice.id)).toHaveLength(1));
    const [first] = await decisionsOf(alice.id);
    expect(first?.label).toBe('Le travail attend dans 1 Projet');

    waiting.set(alice.id, [CREWDECK, SITE_MAIRIE]);
    await app.get(RunnerOffline).refresh(alice.id);

    const [updated, ...others] = await decisionsOf(alice.id);
    expect(others).toEqual([]);
    expect(updated).toMatchObject({ id: first?.id, state: 'open', label: 'Le travail attend dans 2 Projets', meta_parts: ['2 Projets'] });
    expect(parseWaitingProjects(updated?.params['projects'])).toEqual([CREWDECK, SITE_MAIRIE]);
    expect(decisionEvents()).toEqual(['decision.upserted', 'decision.upserted']);
  });

  it('resolves the Décision once the Runner is back online, with decision.removed', async () => {
    const alice = await pilot();
    waiting.set(alice.id, [CREWDECK]);
    const { token, socket } = await online(alice.id);
    await socket.close();
    await vi.waitFor(async () => expect(await decisionsOf(alice.id)).toHaveLength(1));

    // The same Runner reconnects with its token.
    const again = await connectRunner(url, token);
    runners.push(again);
    again.hello();
    await again.expect('hello.accepted');

    await vi.waitFor(async () => expect((await decisionsOf(alice.id))[0]).toMatchObject({ state: 'resolved', outcome: 'runner-back' }));
    expect(decisionEvents()).toEqual(['decision.upserted', 'decision.removed']);
  });

  it('a new Runner replacing the offline one: the old Décision resolved once it connects, never two open', async () => {
    const alice = await pilot();
    waiting.set(alice.id, [CREWDECK]);
    const { runner: old, socket } = await online(alice.id);
    await socket.close();
    await vi.waitFor(async () => expect(await decisionsOf(alice.id)).toHaveLength(1));

    // Revoked by a link that did not go through RunnerLinks (its own transaction resolves it too).
    await sql('UPDATE runners SET revoked_at = now() WHERE id = $1', [old.id]);
    const { runner: next, socket: nextSocket } = await online(alice.id);
    await vi.waitFor(async () => expect((await decisionsOf(alice.id))[0]).toMatchObject({ subject_id: old.id, state: 'resolved', outcome: 'runner-replaced' }));

    await nextSocket.close();
    await vi.waitFor(async () => expect(await decisionsOf(alice.id)).toHaveLength(2));
    const open = (await decisionsOf(alice.id)).filter((decision) => decision.state === 'open');
    expect(open).toEqual([expect.objectContaining({ subject_id: next.id })]);
  });

  it('a refresh overlapping a link’s confirmation that replaces the Runner: both commit, no deadlock', async () => {
    const alice = await pilot();
    waiting.set(alice.id, [CREWDECK]);
    const { runner, socket } = await online(alice.id);
    await socket.close();
    await vi.waitFor(async () => expect(await decisionsOf(alice.id)).toHaveLength(1));
    waiting.set(alice.id, [CREWDECK, SITE_MAIRIE]);

    // As RunnerLinks.confirm: an event first (the Pilote's row locked), then the replaced Runner's Décision resolved.
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked = (): void => undefined;
    const pilotLocked = new Promise<void>((resolve) => (locked = resolve));
    const confirm = runInPilotScope(alice.id, () =>
      app.get(Transactions).run(async (tx) => {
        await app.get(EventsWriter).write(tx, alice.id, 'runner.upserted', runner);
        locked();
        await gate;
        await app.get(RunnerOffline).resolveReplaced(tx, newId());
      }),
    );
    await pilotLocked;
    // The refresh updates the open Décision while the confirmation holds the Pilote's row: it waits on a lock.
    const refresh = app.get(RunnerOffline).refresh(alice.id);
    await vi.waitFor(async () =>
      expect((await sql<{ n: number }>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()"))[0]?.n).toBeGreaterThanOrEqual(1),
    );
    release();

    await expect(Promise.all([confirm, refresh])).resolves.toBeDefined();
    const rows = await decisionsOf(alice.id);
    expect(rows[0]).toMatchObject({ state: 'resolved', outcome: 'runner-replaced' });
    expect(rows.filter((decision) => decision.state === 'open')).toHaveLength(1);
  });

  it('a refresh while the Runner is online raises nothing', async () => {
    const alice = await pilot();
    waiting.set(alice.id, [CREWDECK]);
    await online(alice.id);

    await app.get(RunnerOffline).refresh(alice.id);

    expect(await decisionsOf(alice.id)).toEqual([]);
  });
});
