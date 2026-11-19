import { localSealedOfParam, localTextAad, projectFolderAad, projectNameAad, zDecision, zState } from '@crewdeck/contracts';
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
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
import { sealItem } from '../../src/testing/vault.js';
import { connectRunner, type FakeRunnerClient } from '../fakes/runner.js';
import { connect, type WsClient } from '../fakes/ws-client.js';
import { startApp } from '../route-baseline.js';
import { TicketsWriter } from '../../src/tickets/tickets.writer.js';

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

/** In every text the Pilote wrote in the folder: never in the database, the events nor the logs. */
const MARKER = 'MARQUEUR-7f3a9c';
const CONTENT_HASH = `v1.${'A'.repeat(43)}`;

interface Pilot {
  id: string;
  cookie: string;
  token: string;
}

describe('a Local Projet’s folder followed, against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  const lines: string[] = [];
  const closers: (WsClient | FakeRunnerClient)[] = [];
  const vaultKey = randomBytes(32);

  beforeAll(async () => {
    ({ app, url } = await startApp(env, { logs: { write: (line: string) => lines.push(line) } }));
    prisma = app.get(PrismaService);
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

  /** A live tab of `who`, from now on. */
  const tab = async (who: Pilot): Promise<WsClient> => {
    const client = await connect(url, { cookie: who.cookie, origin: ORIGIN });
    closers.push(client);
    client.send({ type: 'hello', lastSeq: Number((await state(who)).seq) });
    await client.next('live');
    return client;
  };

  /** A Local Projet of `who`, its Sources Local. */
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

  const seal = (projectId: string, text: string, place: string) => sealItem(vaultKey, text, localTextAad(projectId, place));

  const ticket = (projectId: string, number: number, fields: Record<string, unknown> = {}) => ({
    kind: 'ticket' as const,
    number,
    state: 'open',
    stateReason: null,
    readyMark: true,
    labels: ['ready-for-agent', 'priority:P1'],
    labelsSealed: seal(projectId, JSON.stringify(['type:fix', `${MARKER}-label`]), `ticket:${number}:labels`),
    branchPrefix: 'fix',
    visualReview: false,
    titleSealed: seal(projectId, `${MARKER} titre ${number}`, `ticket:${number}:title`),
    milestoneRank: 1,
    blockedBy: [],
    parent: null,
    contentHash: CONTENT_HASH,
    createdAt: '2026-11-18T09:00:00.000Z',
    updatedAt: '2026-11-19T09:00:00.000Z',
    closedAt: null,
    observedAt: '2026-11-19T09:00:01.000Z',
    ...fields,
  });

  const milestone = (projectId: string, rank: number) => ({
    kind: 'milestone' as const,
    rank,
    titleSealed: seal(projectId, `${MARKER} jalon`, `milestone:${rank}:title`),
    dueOn: '2026-12-15',
    observedAt: '2026-11-19T09:00:02.000Z',
  });

  const change = (projectId: string, number: number, ticketNumber: number | null) => ({
    kind: 'change' as const,
    number,
    ticketNumber,
    titleSealed: seal(projectId, `${MARKER} changement`, `change:${number}:title`),
    state: 'open',
    baseRef: 'develop',
    headSha: 'a'.repeat(40),
    mergeSha: null,
    createdAt: '2026-11-19T08:00:00.000Z',
    updatedAt: '2026-11-19T08:30:00.000Z',
    mergedAt: null,
    closedAt: null,
    observedAt: '2026-11-19T09:00:03.000Z',
  });

  const unreadable = (projectId: string, key: string, path: string, reason: 'front-matter' | 'duplicate-number' = 'front-matter') => ({
    key,
    reason,
    pathSealed: seal(projectId, path, `unreadable:${key}:path`),
  });

  const report = (runner: FakeRunnerClient, projectId: string, items: unknown[], fields: { full?: boolean; unreadable?: unknown[]; vaultKeyVersion?: number } = {}) =>
    runner.send({ type: 'local.changed', projectId, vaultKeyVersion: fields.vaultKeyVersion ?? 1, full: fields.full ?? false, items, unreadable: fields.unreadable ?? [] } as never);

  const eventsOf = (who: Pilot) =>
    sql<{ type: string; payload: Record<string, unknown>; source: string | null; source_at: Date | null; tx: string }>(
      `SELECT type, payload, source, source_at, xmin::text AS tx FROM events WHERE pilot_id = $1 AND type NOT LIKE 'runner.%' ORDER BY seq`,
      [who.id],
    );

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

  const tickets = (projectId: string) =>
    sql<{ number: number; source: string; title: string | null; milestone_number: number | null; ready: boolean }>(
      'SELECT number, source, title, milestone_number, ready FROM tickets WHERE project_id = $1 ORDER BY number',
      [projectId],
    );

  const openUnreadable = async (who: Pilot) => (await state(who)).decisions.map((decision) => zDecision.parse(decision)).filter((decision) => decision.kind === 'ticket.local-unreadable');

  it('writes a Ticket edited by hand with source local, its event from the Runner at its observedAt, seen by a tab without reload', async () => {
    const alice = await pilot('alice');
    const runner = await online(alice);
    const projectId = await localProject(alice);
    const client = await tab(alice);

    report(runner, projectId, [ticket(projectId, 12)]);

    const sent = await client.next('event');
    expect(sent.event).toMatchObject({ type: 'ticket.upserted', payload: { projectId, number: 12, source: 'local', title: null, readyMark: true, ready: true, priority: 'P1', branchPrefix: 'fix' } });
    const [event] = (await eventsOf(alice)).filter((candidate) => candidate.type === 'ticket.upserted');
    expect(event).toMatchObject({ source: 'runner', source_at: new Date('2026-11-19T09:00:01.000Z') });
  });

  it('writes the Tickets, milestones and changes of one report with their events in one transaction, a change linked to its Ticket', async () => {
    const alice = await pilot('alice');
    const runner = await online(alice);
    const projectId = await localProject(alice);

    // The Runner sends a text sealed once again as it sealed it (its `reported` rows).
    const seven = ticket(projectId, 7);
    const first = milestone(projectId, 1);
    report(runner, projectId, [seven, ticket(projectId, 12, { blockedBy: [7] }), first, change(projectId, 31, 12)]);

    await eventually(async () => expect(await sql('SELECT number FROM code_changes WHERE project_id = $1', [projectId])).toHaveLength(1));
    expect(await tickets(projectId)).toEqual([
      { number: 7, source: 'local', title: null, milestone_number: 1, ready: true },
      { number: 12, source: 'local', title: null, milestone_number: 1, ready: false },
    ]);
    expect(await sql('SELECT number, rank, source, title, open_count, closed_count FROM milestones WHERE project_id = $1', [projectId])).toEqual([
      { number: 1, rank: 1, source: 'local', title: null, open_count: 2, closed_count: 0 },
    ]);
    expect(await sql('SELECT number, source, ticket_number, head_ref, base_ref FROM code_changes WHERE project_id = $1', [projectId])).toEqual([
      { number: 31, source: 'local', ticket_number: 12, head_ref: null, base_ref: 'develop' },
    ]);
    const written = (await eventsOf(alice)).filter((event) => ['ticket.upserted', 'milestone.upserted', 'code-change.upserted'].includes(event.type));
    expect(written.map((event) => event.type).sort()).toEqual(['code-change.upserted', 'milestone.upserted', 'ticket.upserted', 'ticket.upserted']);
    expect(new Set(written.map((event) => event.tx)).size).toBe(1);
    expect(written.every((event) => event.source === 'runner')).toBe(true);
    expect(written.find((event) => event.type === 'milestone.upserted')?.source_at).toEqual(new Date('2026-11-19T09:00:02.000Z'));
    expect(written.find((event) => event.type === 'code-change.upserted')?.source_at).toEqual(new Date('2026-11-19T09:00:03.000Z'));

    // The same report again writes nothing.
    const before = (await eventsOf(alice)).length;
    report(runner, projectId, [seven, first]);
    report(runner, projectId, [ticket(projectId, 13, { milestoneRank: null })]);
    await eventually(async () => expect((await tickets(projectId)).map((row) => row.number)).toEqual([7, 12, 13]));
    expect((await eventsOf(alice)).slice(before).map((event) => event.type)).toEqual(['ticket.upserted']);
  });

  it('removes a Ticket gone from the folder, and with a full report every Local row it does not hold (Tickets, milestones, changes of code), with their events in its transaction', async () => {
    const alice = await pilot('alice');
    const runner = await online(alice);
    const projectId = await localProject(alice);
    report(runner, projectId, [ticket(projectId, 5), ticket(projectId, 7), ticket(projectId, 12), milestone(projectId, 1), milestone(projectId, 2), change(projectId, 31, 12), change(projectId, 32, 7)]);
    await eventually(async () => expect(await sql('SELECT number FROM code_changes WHERE project_id = $1', [projectId])).toHaveLength(2));
    // A change of GitHub's stays, whatever a full report holds.
    await sql(`UPDATE code_changes SET source = 'github', title = 'Panier partagé', title_sealed = NULL WHERE project_id = $1 AND number = 31`, [projectId]);
    const ids = Object.fromEntries((await sql<{ number: number; id: string }>('SELECT number, id FROM tickets WHERE project_id = $1', [projectId])).map((row) => [row.number, row.id]));
    const [second] = await sql<{ id: string }>('SELECT id FROM milestones WHERE project_id = $1 AND number = 2', [projectId]);
    const [gone] = await sql<{ id: string }>('SELECT id FROM code_changes WHERE project_id = $1 AND number = 32', [projectId]);

    report(runner, projectId, [{ kind: 'ticket-removed', number: 5, observedAt: '2026-11-19T10:00:00.000Z' }]);
    await eventually(async () => expect((await tickets(projectId)).map((row) => row.number)).toEqual([7, 12]));

    const before = (await eventsOf(alice)).length;
    report(runner, projectId, [ticket(projectId, 12), milestone(projectId, 1)], { full: true });
    await eventually(async () => expect((await tickets(projectId)).map((row) => row.number)).toEqual([12]));
    const after = (await eventsOf(alice)).slice(before);
    expect(after.filter((event) => event.type.endsWith('.removed')).map((event) => [event.type, event.payload])).toEqual([
      ['ticket.removed', { id: ids[7] }],
      ['milestone.removed', { id: second?.id }],
      ['code-change.removed', { id: gone?.id }],
    ]);
    expect(new Set(after.map((event) => event.tx)).size).toBe(1);
    expect(await sql('SELECT number, source FROM code_changes WHERE project_id = $1', [projectId])).toEqual([{ number: 31, source: 'github' }]);
    expect(await sql('SELECT number, open_count FROM milestones WHERE project_id = $1', [projectId])).toEqual([{ number: 1, open_count: 1 }]);
    const removed = (await eventsOf(alice)).filter((event) => event.type === 'ticket.removed').map((event) => event.payload);
    expect(removed).toEqual([{ id: ids[5] }, { id: ids[7] }]);
  });

  it('rolls a report back whole when its write fails, and closes the Runner’s socket: its full report on reconnection writes every item', async () => {
    const alice = await pilot('alice');
    const runner = await online(alice);
    const projectId = await localProject(alice);
    const items = [ticket(projectId, 12), change(projectId, 31, 12)];

    // The change of code fails after the Ticket was written, in the same transaction.
    const failing = vi.spyOn(app.get(TicketsWriter), 'upsertCodeChanges').mockRejectedValueOnce(new Error('the connection is lost'));
    try {
      report(runner, projectId, items);
      expect((await runner.closed()).code).toBe(1011);
    } finally {
      failing.mockRestore();
    }
    expect(await tickets(projectId)).toEqual([]);
    expect((await eventsOf(alice)).filter((event) => event.type === 'ticket.upserted')).toEqual([]);

    const again = await online(alice);
    report(again, projectId, items, { full: true });
    await eventually(async () => expect(await sql('SELECT number, ticket_number FROM code_changes WHERE project_id = $1', [projectId])).toEqual([{ number: 31, ticket_number: 12 }]));
    expect((await tickets(projectId)).map((row) => row.number)).toEqual([12]);
  });

  it('writes nothing of a report sealed under a vault key version a rotation left, and the report under the new one', async () => {
    const alice = await pilot('alice');
    const runner = await online(alice);
    const projectId = await localProject(alice);
    report(runner, projectId, [ticket(projectId, 12)], { unreadable: [unreadable(projectId, 'AAECAwQFBgcICQoLDA0ODw', 'tickets/7-courses.md')] });
    await eventually(async () => expect(await tickets(projectId)).toHaveLength(1));
    const stored = () => sql('SELECT number, title_sealed, labels_sealed FROM tickets WHERE project_id = $1 ORDER BY number', [projectId]);
    const decisions = () => sql('SELECT subject_id, params, state FROM decisions WHERE pilot_id = $1 ORDER BY subject_id', [alice.id]);

    // A rotation moved the vault to version 2 (its item keys rewrapped); a report the Runner sealed under 1 arrives after it.
    await sql('UPDATE pilots SET vault_key_version = 2 WHERE id = $1', [alice.id]);
    const before = { tickets: await stored(), decisions: await decisions(), events: (await eventsOf(alice)).length };
    report(runner, projectId, [ticket(projectId, 12), ticket(projectId, 13), milestone(projectId, 1), change(projectId, 31, 12)], { full: true, vaultKeyVersion: 1 });
    await eventually(async () => expect(lines.some((line) => line.includes('local.vault-stale'))).toBe(true));
    expect({ tickets: await stored(), decisions: await decisions(), events: (await eventsOf(alice)).length }).toEqual(before);
    expect(JSON.parse(lines.find((line) => line.includes('local.vault-stale')) ?? '{}')).toMatchObject({ projectId, vaultKeyVersion: 1, current: 2 });

    report(runner, projectId, [ticket(projectId, 12), ticket(projectId, 13)], { vaultKeyVersion: 2 });
    await eventually(async () => expect((await tickets(projectId)).map((row) => row.number)).toEqual([12, 13]));
  });

  it('drops the items of a Projet whose ticket group is on GitHub, its changes kept while its code is Local', async () => {
    const alice = await pilot('alice');
    const runner = await online(alice);
    const projectId = await localProject(alice);
    await sql(`UPDATE artifact_sources SET source = 'github' WHERE project_id = $1 AND "group" = 'ticket'`, [projectId]);

    report(runner, projectId, [ticket(projectId, 12), milestone(projectId, 1), change(projectId, 31, 12)], { full: true, unreadable: [unreadable(projectId, 'AAECAwQFBgcICQoLDA0ODw', 'tickets/7.md')] });

    await eventually(async () => expect(await sql('SELECT number FROM code_changes WHERE project_id = $1', [projectId])).toHaveLength(1));
    expect(await tickets(projectId)).toEqual([]);
    expect(await sql('SELECT number FROM milestones WHERE project_id = $1', [projectId])).toEqual([]);
    expect(await openUnreadable(alice)).toEqual([]);
    const dropped = lines.filter((line) => line.includes('local.not-local')).map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(dropped).toEqual([expect.objectContaining({ projectId, dropped: 3, ticketsLocal: false, codeLocal: true })]);
  });

  it('raises « Fichier de Ticket illisible » once per unreadable file, its path sealed, and resolves it once the file reads', async () => {
    const alice = await pilot('alice');
    const runner = await online(alice);
    const projectId = await localProject(alice);
    const file = unreadable(projectId, 'AAECAwQFBgcICQoLDA0ODw', `tickets/7-${MARKER}.md`);

    report(runner, projectId, [], { unreadable: [file] });
    await eventually(async () => expect(await openUnreadable(alice)).toHaveLength(1));
    const [decision] = await openUnreadable(alice);
    expect(decision).toMatchObject({ kind: 'ticket.local-unreadable', projectId, subjectType: 'project', subjectId: `${projectId}:${file.key}`, tone: 'caution', metaParts: ['front matter illisible'] });
    expect(localSealedOfParam(decision?.params.pathSealed)).toEqual(file.pathSealed);

    // Still unreadable: raised once.
    const before = (await eventsOf(alice)).length;
    report(runner, projectId, [ticket(projectId, 12)], { unreadable: [{ ...file }] });
    await eventually(async () => expect(await tickets(projectId)).toHaveLength(1));
    expect((await eventsOf(alice)).slice(before).map((event) => event.type)).toEqual(['ticket.upserted']);

    report(runner, projectId, [ticket(projectId, 7)]);
    await eventually(async () => expect(await openUnreadable(alice)).toEqual([]));
    const [resolved] = await sql<{ state: string; outcome: string }>(`SELECT state, outcome FROM decisions WHERE kind = 'ticket.local-unreadable'`);
    expect(resolved).toEqual({ state: 'resolved', outcome: 'fixed' });
  });

  it('keeps no file name nor title in the database, the events or the server’s logs', async () => {
    const alice = await pilot('alice');
    const runner = await online(alice);
    const projectId = await localProject(alice);

    report(runner, projectId, [ticket(projectId, 12), milestone(projectId, 1), change(projectId, 31, 12)], { full: true, unreadable: [unreadable(projectId, 'AAECAwQFBgcICQoLDA0ODw', `tickets/7-${MARKER}.md`)] });
    await eventually(async () => expect(await openUnreadable(alice)).toHaveLength(1));
    await eventually(async () => expect(await sql('SELECT number FROM code_changes WHERE project_id = $1', [projectId])).toHaveLength(1));

    expect(await database()).not.toContain(MARKER);
    expect(JSON.stringify(await eventsOf(alice))).not.toContain(MARKER);
    expect(lines.join('\n')).not.toContain(MARKER);
    expect(lines.some((line) => line.includes('local.changed'))).toBe(true);
  });
});
