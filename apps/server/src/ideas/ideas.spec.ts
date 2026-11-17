import type { INestApplication } from '@nestjs/common';
import { expectEnvelope, startApp } from '../../test/route-baseline.js';
import { appOrigin, parseEnv } from '../config/env.js';
import { newId } from '../ids.js';
import type { Tx } from '../realtime/transactions.js';
import { decodeIdeaCursor, encodeIdeaCursor } from './idea-cursor.js';
import { syncIdeasToTriage, triageLabel } from './triage-decision.js';

const PILOT = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a00';
const IDEA = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01';

describe('the label of the Décision « Idées à trier »', () => {
  it('counts the Idées, in the singular for one', () => {
    expect(triageLabel(1)).toBe('1 Idée à trier');
    expect(triageLabel(2)).toBe('2 Idées à trier');
    expect(triageLabel(14)).toBe('14 Idées à trier');
  });
});

describe('syncIdeasToTriage', () => {
  const txCounting = (count: number) => {
    const where: unknown[] = [];
    const tx = { idea: { count: (args: { where: unknown }) => (where.push(args.where), Promise.resolve(count)) } } as unknown as Tx;
    return { tx, where };
  };
  const decisions = () => ({ raise: vi.fn().mockResolvedValue({}), resolve: vi.fn().mockResolvedValue(null) });

  it('raises or relabels the Pilote’s Décision with the count of the Idées in analysis, to triage or analysed', async () => {
    const { tx, where } = txCounting(2);
    const spy = decisions();

    expect(await syncIdeasToTriage(tx, PILOT, spy)).toBe(2);
    expect(where).toEqual([{ state: { in: ['analysing', 'to_triage', 'analysed'] } }]);
    expect(spy.resolve).not.toHaveBeenCalled();
    expect(spy.raise).toHaveBeenCalledWith(tx, {
      kind: 'ideas-to-triage',
      projectId: null,
      projectName: null,
      subjectType: 'pilot',
      subjectId: PILOT,
      label: '2 Idées à trier',
      metaParts: [],
      tone: 'accent',
      link: '/idees',
      params: { count: 2 },
    });
  });

  it('resolves it when none is left', async () => {
    const { tx } = txCounting(0);
    const spy = decisions();

    expect(await syncIdeasToTriage(tx, PILOT, spy)).toBe(0);
    expect(spy.raise).not.toHaveBeenCalled();
    expect(spy.resolve).toHaveBeenCalledWith(tx, 'ideas-to-triage', PILOT, 'triaged');
  });
});

describe('the cursor of the Idées', () => {
  const at = new Date('2026-11-16T08:00:00.000Z');

  it('comes back as the updatedAt and id it was made of', () => {
    const cursor = encodeIdeaCursor({ updatedAt: at, id: IDEA });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeIdeaCursor(cursor)).toEqual({ updatedAt: at, id: IDEA });
  });

  it('is refused when it was not made by the list', () => {
    const encode = (text: string) => Buffer.from(text).toString('base64url');
    expect(decodeIdeaCursor('abc')).toBeUndefined();
    expect(decodeIdeaCursor(encode(`yesterday|${IDEA}`))).toBeUndefined();
    expect(decodeIdeaCursor(encode('2026-11-16T08:00:00.000Z|42'))).toBeUndefined();
    expect(decodeIdeaCursor(encode(`2026-11-16T08:00:00.000Z|${IDEA}|more`))).toBeUndefined();
  });
});

// Nothing listens on port 1: no session can be read. The nominal case, 400, 404 and 409 are proven against PostgreSQL (test/integration/ideas.spec.ts).
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck', NODE_ENV: 'development' });

describe('/api/ideas, without a database', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
  });

  afterAll(() => app.close());

  const call = (method: string, path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method,
      headers: { origin: appOrigin(env), 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it('answers 401 without a session on both routes', async () => {
    await expectEnvelope(await call('POST', '/api/ideas', { id: newId(), projectId: null, notedFrom: 'pc', dictated: false, seq: '1' }), 401, 'auth.required');
    await expectEnvelope(await call('GET', '/api/ideas?states=to-triage'), 401, 'auth.required');
  });

  it('is in the OpenAPI document: the note’s body and 201, the list’s 200', async () => {
    const doc = (await (await fetch(`${url}/api/docs.json`)).json()) as {
      paths: Record<string, { get?: { responses: Record<string, unknown> }; post?: { responses: Record<string, unknown>; requestBody?: unknown } }>;
    };

    expect(doc.paths['/api/ideas']?.post?.responses).toHaveProperty('201');
    expect(doc.paths['/api/ideas']?.post?.requestBody).toBeDefined();
    expect(doc.paths['/api/ideas']?.get?.responses).toHaveProperty('200');
  });
});
