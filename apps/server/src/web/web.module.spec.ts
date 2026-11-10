import type { INestApplication } from '@nestjs/common';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { parseEnv } from '../config/env.js';

const INDEX = '<!doctype html><title>Crewdeck</title>';
// Nothing listens on port 1: the database is down, which the page does not need.
const DATABASE_URL = 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck';

const boot = async (values: Record<string, string>): Promise<INestApplication> => {
  const app = await createApp(parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL, ...values }), { logs: false });
  await app.listen(0, '127.0.0.1');
  return app;
};

describe('the web build at /', () => {
  let dist: string;
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    dist = await mkdtemp(join(tmpdir(), 'crewdeck-web-'));
    await writeFile(join(dist, 'index.html'), INDEX);
    await mkdir(join(dist, 'assets'));
    await writeFile(join(dist, 'assets', 'main.js'), 'console.log(1);');
    app = await boot({ WEB_DIST_DIR: dist });
    url = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
    await rm(dist, { recursive: true, force: true });
  });

  it.each(['/', '/a-toi', '/idees/42'])('serves index.html at %s', async (path) => {
    const response = await fetch(`${url}${path}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await response.text()).toBe(INDEX);
  });

  it('serves the build’s files', async () => {
    const response = await fetch(`${url}/assets/main.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/javascript/);
  });

  it.each(['/api/unknown', '/api', '/runner/unknown'])('answers 404 JSON, not the page, at %s', async (path) => {
    const response = await fetch(`${url}${path}`);

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await response.json()).toMatchObject({ status: 404, code: 'http.not-found' });
  });

  it('still routes the API', async () => {
    const response = await fetch(`${url}/api/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });
});

describe('without WEB_DIST_DIR', () => {
  it('serves no page: Vite does, in development', async () => {
    const app = await boot({});
    try {
      const response = await fetch(`${await app.getUrl()}/a-toi`);

      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    } finally {
      await app.close();
    }
  });
});
