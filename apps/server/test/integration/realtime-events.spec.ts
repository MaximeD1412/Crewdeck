import type { Event } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { EventsBus } from '../../src/realtime/events.bus.js';
import { EventsReplay } from '../../src/realtime/events.replay.js';
import { EventPayloadError, EventsWriter, TransactionMissingError } from '../../src/realtime/events.writer.js';
import { Transactions } from '../../src/realtime/transactions.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');

const sql = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
};

describe('the events writer against PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let transactions: Transactions;
  let writer: EventsWriter;
  let published: { pilotId: string; event: Event }[];
  let pilotId: string;
  let unsubscribe: () => void;

  const me = () => ({ id: pilotId, displayName: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done' as const, identities: [] });

  beforeAll(async () => {
    ({ app } = await startApp(parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl })));
    prisma = app.get(PrismaService);
    transactions = app.get(Transactions);
    writer = app.get(EventsWriter);
  });

  afterAll(async () => {
    await sql('TRUNCATE pilots CASCADE');
    await app.close();
  });

  beforeEach(async () => {
    await sql('TRUNCATE pilots CASCADE');
    published = [];
    pilotId = newId();
    await sql(`INSERT INTO pilots (id, display_name, time_zone) VALUES ($1, 'octocat', 'Europe/Paris')`, [pilotId]);
    unsubscribe = app.get(EventsBus).subscribe(pilotId, (event) => published.push({ pilotId, event }));
  });

  afterEach(() => unsubscribe());

  const inScope = <T>(fn: () => Promise<T>): Promise<T> => runInPilotScope(pilotId, fn);

  it('writes the change and its event in one transaction, then publishes the event once', async () => {
    const seq = await inScope(() =>
      transactions.run(async (tx) => {
        await tx.pilot.update({ where: { id: pilotId }, data: { displayName: 'hubot' } });
        return writer.write(tx, pilotId, 'pilot.upserted', { ...me(), displayName: 'hubot' });
      }),
    );

    expect(seq).toBe(1n);
    const rows = await sql<{ seq: string; type: string; payload: unknown; at: Date }>('SELECT seq, type, payload, at FROM events WHERE pilot_id = $1', [pilotId]);
    expect(rows).toEqual([{ seq: '1', type: 'pilot.upserted', payload: { ...me(), displayName: 'hubot' }, at: expect.any(Date) }]);
    expect(await sql('SELECT display_name, seq FROM pilots WHERE id = $1', [pilotId])).toEqual([{ display_name: 'hubot', seq: '1' }]);
    expect(published).toEqual([
      { pilotId, event: { seq: 1, type: 'pilot.upserted', payload: { ...me(), displayName: 'hubot' }, at: rows[0]?.at.toISOString() } },
    ]);
  });

  it('publishes only after the commit', async () => {
    let seenInside: number | undefined;
    await inScope(() =>
      transactions.run(async (tx) => {
        await writer.write(tx, pilotId, 'pilot.upserted', me());
        seenInside = published.length;
      }),
    );

    expect(seenInside).toBe(0);
    expect(published).toHaveLength(1);
  });

  it('leaves no row and publishes nothing when the transaction rolls back after write', async () => {
    const failing = inScope(() =>
      transactions.run(async (tx) => {
        await tx.pilot.update({ where: { id: pilotId }, data: { displayName: 'hubot' } });
        await writer.write(tx, pilotId, 'pilot.upserted', me());
        throw new Error('the change fails after its event');
      }),
    );

    await expect(failing).rejects.toThrow('the change fails after its event');
    expect(await sql('SELECT * FROM events')).toEqual([]);
    expect(await sql('SELECT display_name, seq FROM pilots WHERE id = $1', [pilotId])).toEqual([{ display_name: 'octocat', seq: '0' }]);
    expect(published).toEqual([]);
  });

  it('gives concurrent transactions of the same Pilote consecutive seq values, none twice', async () => {
    const seqs = await Promise.all(
      Array.from({ length: 8 }, () => inScope(() => transactions.run((tx) => writer.write(tx, pilotId, 'pilot.upserted', me())))),
    );

    expect([...seqs].sort((a, b) => Number(a - b))).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]);
    const rows = await sql<{ seq: string }>('SELECT seq FROM events WHERE pilot_id = $1 ORDER BY seq', [pilotId]);
    expect(rows.map((row) => row.seq)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(published.map(({ event }) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('publishes a Pilote’s events in the order of their seq, even when an earlier commit returns last', async () => {
    const transaction = prisma.scoped.$transaction.bind(prisma.scoped);
    let committed!: () => void;
    let release!: () => void;
    const firstCommitted = new Promise<void>((resolve) => (committed = resolve));
    const firstReleased = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(prisma.scoped, '$transaction').mockImplementationOnce((async (...args: Parameters<typeof transaction>) => {
      const result = await transaction(...args);
      committed();
      await firstReleased;
      return result;
    }) as typeof transaction);
    const write = () => inScope(() => transactions.run((tx) => writer.write(tx, pilotId, 'pilot.upserted', me())));

    const first = write();
    await firstCommitted;
    expect(await write()).toBe(2n);
    expect(published).toEqual([]);
    release();
    expect(await first).toBe(1n);

    expect(published.map(({ event }) => event.seq)).toEqual([1, 2]);
  });

  it('throws on a payload that does not match its registered schema, and writes nothing', async () => {
    const wrong = inScope(() => transactions.run((tx) => writer.write(tx, pilotId, 'pilot.upserted', { ...me(), displayName: '' })));
    await expect(wrong).rejects.toBeInstanceOf(EventPayloadError);
    await expect(wrong).rejects.toThrow(/pilot\.upserted.*displayName/);

    const unregistered = inScope(() => transactions.run((tx) => writer.write(tx, pilotId, 'usage.upserted' as 'pilot.upserted', me())));
    await expect(unregistered).rejects.toThrow(/usage\.upserted/);
    expect(await sql('SELECT * FROM events')).toEqual([]);
    expect(await sql('SELECT seq FROM pilots WHERE id = $1', [pilotId])).toEqual([{ seq: '0' }]);
  });

  it('throws when called outside Transactions.run', async () => {
    const outside = inScope(() => prisma.scoped.$transaction((tx) => writer.write(tx, pilotId, 'pilot.upserted', me())));

    await expect(outside).rejects.toBeInstanceOf(TransactionMissingError);
    expect(await sql('SELECT * FROM events')).toEqual([]);
  });

  it('keeps sourceAt and the source when the source gives them, on the event published and replayed', async () => {
    const sourceAt = new Date('2026-11-11T08:00:00.000Z');
    await inScope(() => transactions.run((tx) => writer.write(tx, pilotId, 'pilot.upserted', me(), { sourceAt, source: 'github' })));

    expect(await sql('SELECT source_at, source FROM events')).toEqual([{ source_at: sourceAt, source: 'github' }]);
    expect(published[0]?.event).toMatchObject({ sourceAt: '2026-11-11T08:00:00.000Z', source: 'github' });
    expect((await app.get(EventsReplay).after(pilotId, 0))?.[0]).toMatchObject({ sourceAt: '2026-11-11T08:00:00.000Z', source: 'github' });
  });

  it('writes neither without them', async () => {
    await inScope(() => transactions.run((tx) => writer.write(tx, pilotId, 'pilot.upserted', me())));

    expect(await sql('SELECT source_at, source FROM events')).toEqual([{ source_at: null, source: null }]);
    expect(published[0]?.event).not.toHaveProperty('source');
    expect(published[0]?.event).not.toHaveProperty('sourceAt');
  });
});
