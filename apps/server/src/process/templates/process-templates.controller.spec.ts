import type { INestApplication } from '@nestjs/common';
import { newId } from '../../ids.js';
import { expectEnvelope, startApp } from '../../../test/route-baseline.js';
import { appOrigin, parseEnv } from '../../config/env.js';

// Nothing listens on port 1: no session can be read. The nominal cases, 400, 404, 409 and 422 are proven against PostgreSQL (test/integration/process-templates.spec.ts).
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck', NODE_ENV: 'development' });

describe('/api/process-templates, without a database', () => {
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
    const save = { id: newId(), name: 'Process Site mairie', projectId: newId(), versionNumber: 3, sealed: null, replace: false };
    await expectEnvelope(await call('POST', '/api/process-templates', save), 401, 'auth.required');
    await expectEnvelope(await call('PATCH', `/api/process-templates/${newId()}`, { name: 'Autre' }), 401, 'auth.required');
    await expectEnvelope(await call('DELETE', `/api/process-templates/${newId()}`), 401, 'auth.required');
  });

  it('is in the OpenAPI document: the save’s body, its 201 and 200, the renaming’s 200 and the deletion’s 204', async () => {
    const doc = (await (await fetch(`${url}/api/docs.json`)).json()) as {
      paths: Record<string, Record<string, { responses: Record<string, unknown>; requestBody?: unknown }>>;
    };

    expect(doc.paths['/api/process-templates']?.['post']?.requestBody).toBeDefined();
    expect(doc.paths['/api/process-templates']?.['post']?.responses).toHaveProperty('201');
    expect(doc.paths['/api/process-templates']?.['post']?.responses).toHaveProperty('200');
    expect(doc.paths['/api/process-templates/{id}']?.['patch']?.requestBody).toBeDefined();
    expect(doc.paths['/api/process-templates/{id}']?.['patch']?.responses).toHaveProperty('200');
    expect(doc.paths['/api/process-templates/{id}']?.['delete']?.responses).toHaveProperty('204');
  });
});
