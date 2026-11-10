import type { INestApplication } from '@nestjs/common';
import { zHealth } from '@crewdeck/contracts';
import { createApp } from '../app.js';
import { parseEnv } from '../config/env.js';

describe('GET /api/health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Nothing listens on port 1: the database is down.
    const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck', CREWDECK_COMMIT: 'abc123' });
    app = await createApp(env, { logs: false });
    await app.listen(0, '127.0.0.1');
  });

  afterAll(() => app.close());

  it('answers without a session, with the commit and the database down', async () => {
    const response = await fetch(`${await app.getUrl()}/api/health`);

    expect(response.status).toBe(200);
    expect(zHealth.parse(await response.json())).toEqual({ status: 'ok', commit: 'abc123', db: 'down' });
  });
});
