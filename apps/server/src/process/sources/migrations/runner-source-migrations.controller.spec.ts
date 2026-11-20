import type { INestApplication } from '@nestjs/common';
import { expectEnvelope, startApp } from '../../../../test/route-baseline.js';
import { parseEnv } from '../../../config/env.js';
import { newId } from '../../../ids.js';

// Nothing listens on port 1: no migration can be read. The nominal case, 404 and 422 are proven against PostgreSQL (test/integration/source-migrations-github-token.spec.ts).
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck', NODE_ENV: 'development' });

describe('/api/runner/source-migrations, without a database', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
  });

  afterAll(() => app.close());

  it('answers 401 runner.token-invalid without a Runner token', async () => {
    await expectEnvelope(await fetch(`${url}/api/runner/source-migrations/${newId()}/github-token`, { method: 'POST' }), 401, 'runner.token-invalid');
  });

  it('is in the OpenAPI document', async () => {
    const doc = (await (await fetch(`${url}/api/docs.json`)).json()) as { paths: Record<string, { post?: { responses: Record<string, unknown> } }> };
    expect(doc.paths['/api/runner/source-migrations/{id}/github-token']?.post?.responses).toHaveProperty('200');
  });
});
