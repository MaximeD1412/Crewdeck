import { randomBytes } from 'node:crypto';
import { type Event, PROCESS_CREWDECK, PROCESS_CREWDECK_NAME, zIdea, zIdeaList, zState } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { DecisionsService } from '../../src/decisions/decisions.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { newId } from '../../src/ids.js';
import { IDEAS_PAGE } from '../../src/ideas/ideas.service.js';
import { syncIdeasToTriage } from '../../src/ideas/triage-decision.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { EventsBus } from '../../src/realtime/events.bus.js';
import { Transactions } from '../../src/realtime/transactions.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { expectEnvelope, expectFields, startApp } from '../route-baseline.js';

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

interface Tab {
  id: string;
  cookie: string;
}

/** A text as the page seals it: its item key and ciphertext, opaque to the server (random bytes here). */
const sealed = (bytes = 64) => ({ key: randomBytes(60).toString('base64url'), ciphertext: randomBytes(bytes).toString('base64url') });

describe('the Idées against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  const logs: string[] = [];
  const published: Event[] = [];
  const unsubscribes: (() => void)[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp(env, { logs: { write: (line: string) => logs.push(line) } }));
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await sql('TRUNCATE pilots CASCADE');
    await app.close();
  });

  beforeEach(async () => {
    await sql('TRUNCATE pilots CASCADE');
    logs.length = 0;
  });

  afterEach(() => {
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    published.length = 0;
  });

  const pilot = async (login = 'octocat'): Promise<Tab> => {
    const id = newId();
    await sql(`WITH p AS (INSERT INTO pilots (id, display_name, time_zone) VALUES ($1, $3, 'Europe/Paris') RETURNING id) INSERT INTO pilot_identities (id, pilot_id, provider, subject, login) SELECT gen_random_uuid(), id, 'github', $2::text, $3 FROM p`, [id, Math.floor(Math.random() * 1e9), login]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    unsubscribes.push(app.get(EventsBus).subscribe(id, (event) => published.push(event)));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  /** A Projet of `tab` (with its repository), its last event at `lastSeq`. */
  const project = async (tab: Tab, name: string, lastSeq = 0): Promise<string> => {
    const repositoryId = newId();
    const id = newId();
    const githubId = Math.floor(Math.random() * 1e9);
    await sql(
      `INSERT INTO repositories (id, pilot_id, installation_id, github_id, owner, name, full_name, private, default_branch, has_code, updated_at)
       VALUES ($1, $2, 61000001, $3, 'octocat', $4, $5, true, 'main', true, now())`,
      [repositoryId, tab.id, githubId, name, `octocat/${name}`],
    );
    await sql(
      `INSERT INTO projects (id, pilot_id, repository_id, github_repo_id, owner, name, full_name, display_name, release_branch, integration_branch, has_code, inventory_state, last_seq)
       VALUES ($1, $2, $3, $4, 'octocat', $5, $6, $5, 'main', 'develop', true, 'not-needed', $7)`,
      [id, tab.id, repositoryId, githubId, name, `octocat/${name}`, lastSeq],
    );
    // Its Sources and its version 1, as following it writes: the state reads them.
    await prisma.unscoped.artifactSource.createMany({
      data: (['ticket', 'code'] as const).map((group) => ({ id: newId(), pilotId: tab.id, projectId: id, group, source: 'github' as const, since: new Date() })),
    });
    await prisma.unscoped.processVersion.create({
      data: {
        id: newId(),
        pilotId: tab.id,
        projectId: id,
        number: 1,
        definition: PROCESS_CREWDECK as unknown as Prisma.InputJsonValue,
        sealed: Prisma.DbNull,
        activatedAt: new Date(),
        activatedBy: 'creation',
        templateName: PROCESS_CREWDECK_NAME,
      },
    });
    return id;
  };

  const call = (tab: Tab | undefined, path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(tab ? { cookie: tab.cookie } : {}), origin: ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const state = async (tab: Tab) => zState.parse(await (await call(tab, '/api/state')).json());

  const noteBody = async (tab: Tab, input: Partial<{ id: string; text: unknown; projectId: string | null; seq: string }> = {}) => ({
    id: newId(),
    text: sealed(),
    projectId: null,
    notedFrom: 'pc',
    dictated: false,
    seq: String((await state(tab)).seq),
    ...input,
  });

  const note = async (tab: Tab, input: Parameters<typeof noteBody>[1] = {}) => call(tab, '/api/ideas', await noteBody(tab, input));

  const openDecisions = (tab: Tab) =>
    sql<{ label: string; state: string; outcome: string | null }>(`SELECT label, state, outcome FROM decisions WHERE pilot_id = $1 AND kind = 'ideas-to-triage' ORDER BY created_at`, [tab.id]);

  describe('POST /api/ideas', () => {
    it('notes the Idée #1 then #2, to triage, for a Projet of the Pilote, with idea.upserted in its transaction', async () => {
      const alice = await pilot();
      const personalOs = await project(alice, 'Personal OS');

      const res = await note(alice, { projectId: personalOs });
      expect(res.status).toBe(201);
      const first = zIdea.parse(await res.json());
      const second = zIdea.parse(await (await note(alice)).json());

      expect(first).toMatchObject({ number: 1, state: 'to-triage', projectId: personalOs, targetProjectId: null, analysis: null, notedFrom: 'pc', dictated: false });
      expect(second).toMatchObject({ number: 2, state: 'to-triage', projectId: null });
      const events = await sql<{ type: string; seq: string; payload: { id: string } }>(`SELECT type, seq, payload FROM events WHERE pilot_id = $1 AND type = 'idea.upserted' ORDER BY seq`, [alice.id]);
      expect(events.map((event) => event.payload.id)).toEqual([first.id, second.id]);
      expect(await sql(`SELECT number, last_seq::text AS "lastSeq" FROM ideas ORDER BY number`)).toEqual([
        { number: 1, lastSeq: events[0]?.seq },
        { number: 2, lastSeq: events[1]?.seq },
      ]);
      expect(await sql(`SELECT idea_seq AS "ideaSeq" FROM pilots WHERE id = $1`, [alice.id])).toEqual([{ ideaSeq: 2 }]);
      expect(published.filter((event) => event.type === 'idea.upserted').map((event) => (event.payload as { number: number }).number)).toEqual([1, 2]);
    });

    it('keeps only the ciphertext the page sent, in the row and the answer, and logs the request without it', async () => {
      const alice = await pilot();
      const text = sealed();

      const idea = zIdea.parse(await (await note(alice, { text })).json());

      expect(idea.text).toEqual(text);
      expect(await sql(`SELECT text FROM ideas WHERE id = $1`, [idea.id])).toEqual([{ text }]);
      const output = logs.join('');
      expect(output).toContain('/api/ideas');
      expect(output).not.toContain(text.ciphertext);
      expect(output).not.toContain(text.key);
    });

    it('stores projectId null when noted without a Projet, and answers 404 for another Pilote’s Projet', async () => {
      const alice = await pilot();
      const bob = await pilot('bob');
      const bobs = await project(bob, 'Site mairie');

      const idea = zIdea.parse(await (await note(alice)).json());
      expect(await sql(`SELECT project_id AS "projectId" FROM ideas WHERE id = $1`, [idea.id])).toEqual([{ projectId: null }]);
      await expectEnvelope(await note(alice, { projectId: bobs }), 404, 'project.not-found');
      await expectEnvelope(await note(alice, { projectId: newId() }), 404, 'project.not-found');
      expect(await sql(`SELECT count(*)::int AS n FROM ideas`)).toEqual([{ n: 1 }]);
    });

    it('answers 400 with fields for an empty text, a text not sealed, or a bad notedFrom', async () => {
      const alice = await pilot();
      // A sealed empty text: the 12 bytes of the nonce and the 16 of the tag, nothing between.
      await expectFields(await note(alice, { text: sealed(28) }), ['text.ciphertext']);
      await expectFields(await note(alice, { text: 'Pouvoir dupliquer une recette' }), ['text']);
      await expectFields(await call(alice, '/api/ideas', { ...(await noteBody(alice)), notedFrom: 'tablette' }), ['notedFrom']);
      expect(await sql(`SELECT count(*)::int AS n FROM ideas`)).toEqual([{ n: 0 }]);
    });

    it('answers 409 realtime.stale when the chosen Projet changed since seq, and 409 idea.id-taken for an id already an Idée’s', async () => {
      const alice = await pilot();
      const changed = await project(alice, 'Crewdeck', 1_000_000);

      await expectEnvelope(await note(alice, { projectId: changed }), 409, 'realtime.stale');
      const idea = zIdea.parse(await (await note(alice)).json());
      await expectEnvelope(await note(alice, { id: idea.id }), 409, 'idea.id-taken');
      expect(await sql(`SELECT number FROM ideas`)).toEqual([{ number: 1 }]);
      expect(await sql(`SELECT idea_seq AS "ideaSeq" FROM pilots WHERE id = $1`, [alice.id])).toEqual([{ ideaSeq: 1 }]);
    });

    it('answers 401 without a session', async () => {
      const alice = await pilot();
      await expectEnvelope(await call(undefined, '/api/ideas', await noteBody(alice)), 401, 'auth.required');
    });
  });

  describe('the Décision « Idées à trier »', () => {
    it('reads « 1 Idée à trier », then « 2 Idées à trier », one open row, and is resolved when none is left', async () => {
      const alice = await pilot();

      await note(alice);
      expect(await openDecisions(alice)).toEqual([{ label: '1 Idée à trier', state: 'open', outcome: null }]);
      await note(alice);
      expect(await openDecisions(alice)).toEqual([{ label: '2 Idées à trier', state: 'open', outcome: null }]);
      const [decision] = (await state(alice)).decisions;
      expect(decision).toMatchObject({ kind: 'ideas-to-triage', label: '2 Idées à trier', link: '/idees', projectId: null });

      // A triage (IDEE-2) moves them out of « à trier », then calls the same sync: the last one triaged resolves it.
      await sql(`UPDATE ideas SET state = 'retained'`);
      await note(alice);
      expect((await openDecisions(alice)).at(-1)).toEqual({ label: '1 Idée à trier', state: 'open', outcome: null });
      await sql(`UPDATE ideas SET state = 'rejected'`);
      await runInPilotScope(alice.id, () => app.get(Transactions).run((tx) => syncIdeasToTriage(tx, alice.id, app.get(DecisionsService))));
      expect(await openDecisions(alice)).toEqual([{ label: '1 Idée à trier', state: 'resolved', outcome: 'triaged' }]);
    });
  });

  describe('GET /api/ideas and the ideas slice', () => {
    /** `n` Idées of `tab` in `state`, the last one updated `days` ago and each earlier one a minute before. */
    const seed = async (tab: Tab, n: number, state: string, days = 0, from = 1) => {
      for (let index = 0; index < n; index += 1) {
        const at = new Date(Date.now() - days * 86_400_000 - (n - index) * 60_000);
        await sql(
          `INSERT INTO ideas (id, pilot_id, number, state, text, noted_from, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'pc', $6, $6)`,
          [newId(), tab.id, from + index, state, JSON.stringify(sealed()), at],
        );
      }
    };

    it('pages the Idées in states by 50, the last updated first, with the cursor of the next page', async () => {
      const alice = await pilot();
      await seed(alice, IDEAS_PAGE + 2, 'merged');
      await seed(alice, 1, 'to-triage', 0, 100);

      const first = zIdeaList.parse(await (await call(alice, '/api/ideas?states=merged,rejected')).json());
      expect(first.items).toHaveLength(IDEAS_PAGE);
      expect(first.items[0]?.number).toBe(IDEAS_PAGE + 2);
      expect(first.items.every((idea) => idea.state === 'merged')).toBe(true);
      expect(first.nextCursor).not.toBeNull();
      const second = zIdeaList.parse(await (await call(alice, `/api/ideas?states=merged&cursor=${first.nextCursor}`)).json());
      expect(second.items.map((idea) => idea.number)).toEqual([2, 1]);
      expect(second.nextCursor).toBeNull();
    });

    it('answers 400 without states, for an unknown state or a cursor it did not give, 401 without a session', async () => {
      const alice = await pilot();
      await expectFields(await call(alice, '/api/ideas'), ['states']);
      await expectFields(await call(alice, '/api/ideas?states=perdue'), ['states.0']);
      await expectFields(await call(alice, '/api/ideas?states=merged&cursor=abc'), ['cursor']);
      await expectEnvelope(await call(undefined, '/api/ideas?states=merged'), 401, 'auth.required');
    });

    it('never lists another Pilote’s Idées', async () => {
      const alice = await pilot();
      const bob = await pilot('bob');
      await seed(bob, 2, 'to-triage');

      expect(zIdeaList.parse(await (await call(alice, '/api/ideas?states=to-triage')).json()).items).toEqual([]);
      expect((await state(alice)).ideas).toEqual([]);
      expect((await state(bob)).ideas).toHaveLength(2);
    });

    it('holds in the slice every Idée not merged nor rejected, the closed ones of the last 90 days, the last noted first', async () => {
      const alice = await pilot();
      await seed(alice, 1, 'retained', 400, 1);
      await seed(alice, 1, 'merged', 120, 2);
      await seed(alice, 1, 'rejected', 30, 3);
      await seed(alice, 1, 'to-triage', 0, 4);

      expect((await state(alice)).ideas.map((idea) => [idea.number, idea.state])).toEqual([
        [4, 'to-triage'],
        [3, 'rejected'],
        [1, 'retained'],
      ]);
    });
  });
});
