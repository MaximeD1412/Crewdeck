import { type Event, zDecisionList, zState } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { parseEnv } from '../../src/config/env.js';
import { RESOLVED_PAGE } from '../../src/decisions/decisions.controller.js';
import { DecisionsService, type RaiseInput } from '../../src/decisions/decisions.service.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { EventsBus } from '../../src/realtime/events.bus.js';
import { EventsWriter } from '../../src/realtime/events.writer.js';
import { Transactions } from '../../src/realtime/transactions.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { expectEnvelope, expectFields, startApp } from '../route-baseline.js';

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

const BLOCKED: RaiseInput = {
  kind: 'ticket-blocked',
  projectId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a02',
  projectName: 'Crewdeck',
  subjectType: 'ticket',
  subjectId: '42',
  label: '#42 Connexion GitHub',
  metaParts: ['Code'],
  tone: 'halt',
  link: '/boucle?ticket=42',
  params: { number: 42 },
};

describe('the Décisions against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let decisions: DecisionsService;
  let transactions: Transactions;
  const published: Event[] = [];
  const unsubscribes: (() => void)[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    prisma = app.get(PrismaService);
    decisions = app.get(DecisionsService);
    transactions = app.get(Transactions);
  });

  afterAll(async () => {
    await sql('TRUNCATE pilots CASCADE');
    await app.close();
  });

  beforeEach(() => sql('TRUNCATE pilots CASCADE'));

  afterEach(() => {
    vi.restoreAllMocks();
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    published.length = 0;
  });

  /** A Pilote with a session, whose published events land in `published`. */
  const pilot = async (login = 'octocat'): Promise<{ id: string; cookie: string }> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, display_name, time_zone) VALUES ($1, $2, 'Europe/Paris')`, [id, login]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    unsubscribes.push(app.get(EventsBus).subscribe(id, (event) => published.push(event)));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  const raise = (pilotId: string, input: Partial<RaiseInput> = {}) =>
    runInPilotScope(pilotId, () => transactions.run((tx) => decisions.raise(tx, { ...BLOCKED, ...input })));
  const resolve = (pilotId: string, kind = BLOCKED.kind, subjectId = BLOCKED.subjectId) =>
    runInPilotScope(pilotId, () => transactions.run((tx) => decisions.resolve(tx, kind, subjectId, 'answered')));
  const list = (cookie: string | undefined, query: string) => fetch(`${url}/api/decisions${query}`, { headers: cookie ? { cookie } : {} });

  describe('DecisionsService', () => {
    it('updates the one open row when raised twice for the same subject, with two decision.upserted', async () => {
      const alice = await pilot();
      const first = await raise(alice.id);
      const second = await raise(alice.id, { label: '#42 Connexion GitHub, encore', metaParts: ['Code', 'relancé'], tone: 'caution' });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.decision).toMatchObject({ id: first.decision.id, label: '#42 Connexion GitHub, encore', metaParts: ['Code', 'relancé'], tone: 'caution' });
      expect(await sql('SELECT id, state FROM decisions')).toEqual([{ id: first.decision.id, state: 'open' }]);
      expect(published.map((event) => [event.type, (event.payload as { id: string }).id])).toEqual([
        ['decision.upserted', first.decision.id],
        ['decision.upserted', first.decision.id],
      ]);
    });

    it('resolves the open one with decision.removed, then a new raise opens a new row', async () => {
      const alice = await pilot();
      const first = await raise(alice.id);
      const resolved = await resolve(alice.id);
      const again = await raise(alice.id);

      expect(resolved).toMatchObject({ id: first.decision.id, state: 'resolved', outcome: 'answered' });
      expect(resolved?.resolvedAt).not.toBeNull();
      expect(again.created).toBe(true);
      expect(again.decision.id).not.toBe(first.decision.id);
      expect(await sql('SELECT id, state, outcome FROM decisions ORDER BY created_at, id')).toEqual([
        { id: first.decision.id, state: 'resolved', outcome: 'answered' },
        { id: again.decision.id, state: 'open', outcome: null },
      ]);
      expect(published.map((event) => event.type)).toEqual(['decision.upserted', 'decision.removed', 'decision.upserted']);
      expect(published[1]?.payload).toEqual({ id: first.decision.id });
    });

    /**
     * Holds the next call's transaction between its read of the open Décision
     * and its update, until `release()`; `read` settles once it has read.
     */
    const holdAfterRead = () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let hasRead!: () => void;
      const read = new Promise<void>((resolve) => (hasRead = resolve));
      const service = decisions as unknown as { whileOpen: (...args: unknown[]) => Promise<unknown> };
      const original = service.whileOpen.bind(decisions);
      vi.spyOn(service, 'whileOpen').mockImplementationOnce(async (...args) => {
        hasRead();
        await gate;
        return original(...args);
      });
      return { read, release };
    };

    it('opens a new Décision when the open one is resolved between the read and the update of a raise', async () => {
      const alice = await pilot();
      const first = await raise(alice.id);
      const held = holdAfterRead();
      const raising = raise(alice.id, { label: '#42 Connexion GitHub, encore' });
      await held.read;
      await resolve(alice.id);
      held.release();
      const again = await raising;

      expect(again.created).toBe(true);
      expect(again.decision).toMatchObject({ state: 'open', label: '#42 Connexion GitHub, encore' });
      expect(again.decision.id).not.toBe(first.decision.id);
      expect(await sql('SELECT id, state, label FROM decisions ORDER BY created_at, id')).toEqual([
        { id: first.decision.id, state: 'resolved', label: '#42 Connexion GitHub' },
        { id: again.decision.id, state: 'open', label: '#42 Connexion GitHub, encore' },
      ]);
      expect(published.map((event) => [event.type, (event.payload as { id: string }).id])).toEqual([
        ['decision.upserted', first.decision.id],
        ['decision.removed', first.decision.id],
        ['decision.upserted', again.decision.id],
      ]);
      expect(published.every((event) => event.type !== 'decision.upserted' || (event.payload as { state: string }).state === 'open')).toBe(true);
    });

    it('resolves a Décision once when two resolve it at the same time', async () => {
      const alice = await pilot();
      const first = await raise(alice.id);
      const held = holdAfterRead();
      const resolving = resolve(alice.id);
      await held.read;
      const winner = await runInPilotScope(alice.id, () => transactions.run((tx) => decisions.resolve(tx, BLOCKED.kind, BLOCKED.subjectId, 'dismissed')));
      held.release();

      expect(winner).toMatchObject({ id: first.decision.id, outcome: 'dismissed' });
      expect(await resolving).toBeUndefined();
      expect(await sql('SELECT state, outcome FROM decisions')).toEqual([{ state: 'resolved', outcome: 'dismissed' }]);
      expect(published.map((event) => event.type)).toEqual(['decision.upserted', 'decision.removed']);
    });

    it('does nothing when resolving a subject with no open Décision', async () => {
      const alice = await pilot();
      expect(await resolve(alice.id)).toBeUndefined();
      expect(published).toEqual([]);
    });

    it('keeps one open Décision per kind and subject, apart per Pilote', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      await raise(alice.id);
      await raise(alice.id, { kind: 'ticket-interrupted', tone: 'caution' });
      await raise(alice.id, { subjectId: '43', label: '#43 Liste des Projets' });
      await raise(bob.id);
      expect(await sql('SELECT count(*)::int AS n FROM decisions WHERE state = $1', ['open'])).toEqual([{ n: 4 }]);
    });

    it('writes nothing when its event fails: the Décision rolls back with it', async () => {
      const alice = await pilot();
      vi.spyOn(app.get(EventsWriter), 'write').mockRejectedValueOnce(new Error('the event is not written'));

      await expect(raise(alice.id)).rejects.toThrow('the event is not written');
      expect(await sql('SELECT * FROM decisions')).toEqual([]);
      expect(published).toEqual([]);
    });

    it('rolls the Décision back when the module’s change fails after it', async () => {
      const alice = await pilot();
      const failing = runInPilotScope(alice.id, () =>
        transactions.run(async (tx) => {
          await decisions.raise(tx, BLOCKED);
          throw new Error('the module fails');
        }),
      );
      await expect(failing).rejects.toThrow('the module fails');
      expect(await sql('SELECT * FROM decisions')).toEqual([]);
      expect(await sql('SELECT * FROM events')).toEqual([]);
      expect(published).toEqual([]);
    });

    it('asserts a Décision is open: 409 once resolved, 404 for another Pilote’s', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const { decision } = await raise(alice.id);
      const assertOpen = (pilotId: string) => runInPilotScope(pilotId, () => transactions.run((tx) => decisions.assertOpen(tx, decision.id)));

      await expect(assertOpen(alice.id)).resolves.toMatchObject({ id: decision.id, state: 'open' });
      await expect(assertOpen(bob.id)).rejects.toMatchObject({ status: 404, code: 'decision.not-found' });
      await resolve(alice.id);
      await expect(assertOpen(alice.id)).rejects.toMatchObject({
        status: 409,
        code: 'decision.already-answered',
        message: 'Cette Décision a déjà été prise.',
      });
    });
  });

  describe('GET /api/decisions', () => {
    it('lists every open Décision of the Pilote, newest first, matching the schema', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const older = await raise(alice.id);
      const newer = await raise(alice.id, { kind: 'visual-review', subjectId: '38', label: '#38 Page Planning', tone: 'accent' });
      await raise(alice.id, { kind: 'step-failed', subjectId: '50' });
      await resolve(alice.id, 'step-failed', '50');
      await raise(bob.id, { subjectId: '99' });

      const res = await list(alice.cookie, '?state=open');
      expect(res.status).toBe(200);
      const body = zDecisionList.parse(await res.json());
      expect(body.items.map((decision) => decision.id)).toEqual([newer.decision.id, older.decision.id]);
      expect(body.nextCursor).toBeNull();
      expect(body.items[1]).toEqual(older.decision);
    });

    it('keeps one Projet’s with projectId', async () => {
      const alice = await pilot();
      const crewdeck = await raise(alice.id);
      await raise(alice.id, { subjectId: '51', projectId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a03', projectName: 'Personal OS' });

      const body = zDecisionList.parse(await (await list(alice.cookie, `?state=open&projectId=${BLOCKED.projectId}`)).json());
      expect(body.items.map((decision) => decision.id)).toEqual([crewdeck.decision.id]);
    });

    it('pages the resolved ones by 50, newest first, to the end', async () => {
      const alice = await pilot();
      const total = RESOLVED_PAGE + 3;
      for (let n = 0; n < total; n += 1) {
        await raise(alice.id, { subjectId: String(n) });
        await resolve(alice.id, BLOCKED.kind, String(n));
      }
      const first = zDecisionList.parse(await (await list(alice.cookie, '?state=resolved')).json());
      expect(first.items).toHaveLength(RESOLVED_PAGE);
      expect(first.items[0]?.subjectId).toBe(String(total - 1));
      expect(first.nextCursor).not.toBeNull();
      const second = zDecisionList.parse(await (await list(alice.cookie, `?state=resolved&cursor=${first.nextCursor}`)).json());
      expect(second.items.map((decision) => decision.subjectId)).toEqual(['2', '1', '0']);
      expect(second.nextCursor).toBeNull();
    });

    it('answers 400 without a state, or with a cursor it did not give', async () => {
      const alice = await pilot();
      await expectFields(await list(alice.cookie, ''), ['state']);
      await expectFields(await list(alice.cookie, '?state=pending'), ['state']);
      await expectFields(await list(alice.cookie, '?state=resolved&cursor=nope'), ['cursor']);
    });

    it('answers 401 without a session', async () => {
      await expectEnvelope(await list(undefined, '?state=open'), 401, 'auth.required');
    });

    it('never lists another Pilote’s Décisions', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      await raise(bob.id);
      await resolve(bob.id);
      await raise(bob.id);

      for (const state of ['open', 'resolved']) {
        expect(zDecisionList.parse(await (await list(alice.cookie, `?state=${state}`)).json()).items).toEqual([]);
      }
    });
  });

  describe('the decisions slice of GET /api/state', () => {
    it('holds the Pilote’s open Décisions, newest first, none of another’s', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const older = await raise(alice.id);
      const newer = await raise(alice.id, { kind: 'agent-question', subjectId: 'session-1', tone: 'accent' });
      await raise(alice.id, { kind: 'step-failed', subjectId: '50' });
      await resolve(alice.id, 'step-failed', '50');
      await raise(bob.id, { subjectId: '99' });

      const state = zState.parse(await (await fetch(`${url}/api/state`, { headers: { cookie: alice.cookie } })).json());
      expect(state.decisions).toEqual([newer.decision, older.decision]);
    });
  });
});
