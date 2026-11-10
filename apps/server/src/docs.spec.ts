import type { INestApplication } from '@nestjs/common';
import { expectEnvelope, startApp } from '../test/route-baseline.js';
import { type Env, parseEnv } from './config/env.js';

const envOf = (NODE_ENV: Env['NODE_ENV']): Env => parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck', NODE_ENV });

interface OpenApi {
  openapi: string;
  paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema: { $ref?: string } }> }> }>>;
  components: { schemas: Record<string, { properties?: Record<string, unknown>; required?: string[] }> };
}

describe('OpenAPI, outside production', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    ({ app, url } = await startApp(envOf('development')));
  });

  afterAll(() => app.close());

  it('serves /api/docs.json, generated from the DTOs’ schemas', async () => {
    const res = await fetch(`${url}/api/docs.json`);

    expect(res.status).toBe(200);
    const doc = (await res.json()) as OpenApi;
    const ref = doc.paths['/api/health']?.get?.responses['200']?.content?.['application/json']?.schema.$ref ?? '';
    const schema = doc.components.schemas[ref.split('/').pop() ?? ''];
    expect(schema?.required?.sort()).toEqual(['commit', 'db', 'status']);
  });

  it('serves the docs’ page at /api/docs', async () => {
    const res = await fetch(`${url}/api/docs`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
  });
});

describe('OpenAPI, in production', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    ({ app, url } = await startApp(envOf('production')));
  });

  afterAll(() => app.close());

  it.each(['/api/docs.json', '/api/docs'])('answers %s with 404 http.not-found', async (path) => {
    await expectEnvelope(await fetch(`${url}${path}`), 404, 'http.not-found');
  });
});
