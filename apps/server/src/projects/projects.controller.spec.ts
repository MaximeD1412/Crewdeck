import type { INestApplication } from '@nestjs/common';
import { newId } from '../ids.js';
import { expectEnvelope, startApp } from '../../test/route-baseline.js';
import { appOrigin, parseEnv } from '../config/env.js';
import { projectNamesOf } from './project-names.js';

// Nothing listens on port 1: no session can be read. The nominal case, 400, 404, 409 and 422 are proven against PostgreSQL (test/integration/projects.spec.ts).
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck', NODE_ENV: 'development' });

describe('/api/projects, without a database', () => {
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
    await expectEnvelope(await call('POST', '/api/projects', { repositoryIds: [newId()], seq: '1' }), 401, 'auth.required');
    await expectEnvelope(await call('GET', '/api/projects'), 401, 'auth.required');
    await expectEnvelope(await call('GET', `/api/projects/${newId()}`), 401, 'auth.required');
  });

  it('is in the OpenAPI document: the follow’s body, its 201 and the list’s 200', async () => {
    const doc = (await (await fetch(`${url}/api/docs.json`)).json()) as {
      paths: Record<string, { get?: { responses: Record<string, unknown> }; post?: { responses: Record<string, unknown>; requestBody?: unknown } }>;
    };

    expect(doc.paths['/api/projects']?.post?.responses).toHaveProperty('201');
    expect(doc.paths['/api/projects']?.post?.requestBody).toBeDefined();
    expect(doc.paths['/api/projects']?.get?.responses).toHaveProperty('200');
    expect(doc.paths['/api/projects/{id}']?.get?.responses).toHaveProperty('200');
  });
});

describe('projectNamesOf', () => {
  it('names the Projet after its repository, its integration branch develop and its release branch the default one', () => {
    expect(projectNamesOf({ name: 'site-mairie', defaultBranch: 'main' })).toEqual({ displayName: 'site-mairie', integrationBranch: 'develop', releaseBranch: 'main' });
  });
});
