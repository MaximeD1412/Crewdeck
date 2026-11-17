import type { SessionStep } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import { expectEnvelope, startApp } from '../../test/route-baseline.js';
import { appOrigin, parseEnv } from '../config/env.js';
import { newId } from '../ids.js';
import { decodeSessionCursor, encodeSessionCursor } from './session-cursor.js';
import { permissionModeOf } from './sessions.service.js';

// Nothing listens on port 1: no session can be read. The nominal case, 400, 404, 409 and 422 are proven against PostgreSQL (test/integration/sessions.spec.ts).
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck', NODE_ENV: 'development' });

describe('/api/sessions, without a database', () => {
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

  it('answers 401 without a session on every route', async () => {
    const id = newId();
    await expectEnvelope(await call('GET', '/api/sessions'), 401, 'auth.required');
    await expectEnvelope(await call('GET', `/api/sessions/${id}`), 401, 'auth.required');
    await expectEnvelope(await call('POST', `/api/sessions/${id}/stop`, { seq: '1' }), 401, 'auth.required');
    await expectEnvelope(await call('POST', `/api/sessions/${id}/resume`, { seq: '1' }), 401, 'auth.required');
  });

  it('is in the OpenAPI document: the list, one Session, stop and resume with their body', async () => {
    const doc = (await (await fetch(`${url}/api/docs.json`)).json()) as {
      paths: Record<string, { get?: { responses: Record<string, unknown> }; post?: { responses: Record<string, unknown>; requestBody?: unknown } }>;
    };

    expect(doc.paths['/api/sessions']?.get?.responses).toHaveProperty('200');
    expect(doc.paths['/api/sessions/{id}']?.get?.responses).toHaveProperty('200');
    for (const action of ['stop', 'resume']) {
      expect(doc.paths[`/api/sessions/{id}/${action}`]?.post?.responses).toHaveProperty('200');
      expect(doc.paths[`/api/sessions/{id}/${action}`]?.post?.requestBody).toBeDefined();
    }
  });
});

describe('permissionModeOf', () => {
  it('bypasses the prompts for the Étapes that work in their worktree, and asks auto of the others and of a Session without an Étape', () => {
    const step = (stepKind: SessionStep['stepKind']): SessionStep => ({ stepRunId: newId(), stepKind });

    expect((['code', 'review', 'cross-review'] as const).map((kind) => permissionModeOf(step(kind)))).toEqual(['bypass', 'bypass', 'bypass']);
    expect(permissionModeOf(step('prd'))).toBe('auto');
    expect(permissionModeOf(undefined)).toBe('auto');
  });
});

describe('the Sessions’ cursor', () => {
  it('gives back what it encodes, and refuses what it did not', () => {
    const at = new Date('2026-11-16T10:00:00.000Z');
    const id = newId();

    expect(decodeSessionCursor(encodeSessionCursor({ startedAt: at, id }))).toEqual({ startedAt: at, id });
    expect(decodeSessionCursor('nope')).toBeUndefined();
  });
});
