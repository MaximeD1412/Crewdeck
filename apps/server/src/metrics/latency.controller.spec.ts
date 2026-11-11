import type { INestApplication } from '@nestjs/common';
import { expectEnvelope, startApp } from '../../test/route-baseline.js';
import { appOrigin, parseEnv } from '../config/env.js';
import { LATENCY_PATH } from './beacon-body.js';

// Nothing listens on port 1: no session can be read, nothing is written. The 204, 400 and the drop are proven against PostgreSQL (test/integration/metrics.spec.ts).
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck', NODE_ENV: 'development' });
const BATCH = JSON.stringify({ samples: [{ seq: '1', source: 'github', delayMs: 300, at: '2026-11-11T08:00:00.300Z' }] });

describe('POST /api/metrics/latency, without a database', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
  });

  afterAll(() => app.close());

  const post = (body: string, contentType: string): Promise<Response> =>
    fetch(`${url}${LATENCY_PATH}`, { method: 'POST', headers: { origin: appOrigin(env), 'content-type': contentType }, body });

  it('answers 401 without a session, as JSON and as the text/plain of sendBeacon', async () => {
    await expectEnvelope(await post(BATCH, 'application/json'), 401, 'auth.required');
    await expectEnvelope(await post(BATCH, 'text/plain;charset=UTF-8'), 401, 'auth.required');
  });

  it('answers 400 to a text/plain body that is not JSON, before any session is read', async () => {
    await expectEnvelope(await post('{"samples": [', 'text/plain'), 400, 'http.bad-request');
  });

  it('is in the OpenAPI document, its body the batch’s schema', async () => {
    const doc = (await (await fetch(`${url}/api/docs.json`)).json()) as { paths: Record<string, { post?: { responses: Record<string, unknown>; requestBody?: unknown } }> };

    expect(doc.paths[LATENCY_PATH]?.post?.responses).toHaveProperty('204');
    expect(doc.paths[LATENCY_PATH]?.post?.requestBody).toBeDefined();
  });
});
