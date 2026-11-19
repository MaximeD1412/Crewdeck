import type { INestApplication } from '@nestjs/common';
import { expectEnvelope, startApp } from '../../test/route-baseline.js';
import { appOrigin, parseEnv } from '../config/env.js';
import { newId } from '../ids.js';

// Nothing listens on port 1: no Process can be read. The nominal case, 400, 404, 409 and 422 are proven against PostgreSQL (test/integration/process-activation.spec.ts).
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck', NODE_ENV: 'development' });

describe('POST /api/projects/:id/process/activate, without a database', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    // The boot check of the Actions sensibles refuses a route whose body has no `seq`: starting proves it has one.
    ({ app, url } = await startApp(env));
  });

  afterAll(() => app.close());

  it('answers 401 without a session', async () => {
    const response = await fetch(`${url}/api/projects/${newId()}/process/activate`, {
      method: 'POST',
      headers: { origin: appOrigin(env), 'content-type': 'application/json' },
      body: JSON.stringify({ revision: 1, seq: '1' }),
    });
    await expectEnvelope(response, 401, 'auth.required');
  });

  it('is in the OpenAPI document, with its body and its answer', async () => {
    const doc = (await (await fetch(`${url}/api/docs.json`)).json()) as {
      paths: Record<string, { post?: { responses: Record<string, unknown>; requestBody?: unknown } }>;
    };
    expect(doc.paths['/api/projects/{id}/process/activate']?.post?.responses).toHaveProperty('200');
    expect(doc.paths['/api/projects/{id}/process/activate']?.post?.requestBody).toBeDefined();
  });
});
