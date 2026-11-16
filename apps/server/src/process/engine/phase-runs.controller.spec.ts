import type { INestApplication } from '@nestjs/common';
import { expectEnvelope, startApp } from '../../../test/route-baseline.js';
import { appOrigin, parseEnv } from '../../config/env.js';
import { newId } from '../../ids.js';

// Nothing listens on port 1: no PhaseRun can be read. The nominal cases, 400, 404, 409 and 422 are proven against PostgreSQL (test/integration/process-loop-backs.spec.ts).
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck', NODE_ENV: 'development' });

describe('/api/phase-runs, without a database', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
  });

  afterAll(() => app.close());

  it('answers 401 without a session on every route', async () => {
    for (const answer of ['one-more-pass', 'stop']) {
      const response = await fetch(`${url}/api/phase-runs/${newId()}/${answer}`, {
        method: 'POST',
        headers: { origin: appOrigin(env), 'content-type': 'application/json' },
        body: JSON.stringify({ decisionId: newId() }),
      });
      await expectEnvelope(response, 401, 'auth.required');
    }
  });

  it('is in the OpenAPI document: « Encore un passage » and « Arrêter », with their body', async () => {
    const doc = (await (await fetch(`${url}/api/docs.json`)).json()) as {
      paths: Record<string, { post?: { responses: Record<string, unknown>; requestBody?: unknown } }>;
    };

    for (const answer of ['one-more-pass', 'stop']) {
      expect(doc.paths[`/api/phase-runs/{id}/${answer}`]?.post?.responses).toHaveProperty('200');
      expect(doc.paths[`/api/phase-runs/{id}/${answer}`]?.post?.requestBody).toBeDefined();
    }
  });
});
