import type { INestApplication } from '@nestjs/common';
import { zHealth } from '@crewdeck/contracts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { parseEnv } from '../config/env.js';

// Nothing listens on port 1: the database is down.
const BASE_ENV = { CREWDECK_ENV: 'test', DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck', CREWDECK_COMMIT: 'abc123' };

async function start(extra: Record<string, string> = {}): Promise<INestApplication> {
  const app = await createApp(parseEnv({ ...BASE_ENV, ...extra }), { logs: false });
  await app.listen(0, '127.0.0.1');
  return app;
}

const health = async (app: INestApplication): Promise<unknown> => {
  const response = await fetch(`${await app.getUrl()}/api/health`);
  expect(response.status).toBe(200);
  return zHealth.parse(await response.json());
};

describe('GET /api/health', () => {
  describe('without BACKUP_STATUS_FILE (staging, development)', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await start();
    });

    afterAll(() => app.close());

    it('answers without a session, with the commit and the database down, and no backup key', async () => {
      expect(await health(app)).toStrictEqual({ status: 'ok', commit: 'abc123', db: 'down' });
    });
  });

  describe('with BACKUP_STATUS_FILE (production)', () => {
    let app: INestApplication;
    let dir: string;
    let file: string;

    beforeAll(async () => {
      dir = mkdtempSync(join(tmpdir(), 'crewdeck-health-'));
      file = join(dir, 'last-success');
      app = await start({ BACKUP_STATUS_FILE: file });
    });

    afterAll(async () => {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('reports the instant the backup wrote, read at each request', async () => {
      writeFileSync(file, '2026-11-10T01:41:07Z\n');
      expect(await health(app)).toMatchObject({ backup: { lastSuccessAt: '2026-11-10T01:41:07Z' } });

      writeFileSync(file, '2026-11-11T01:38:52Z\n');
      expect(await health(app)).toMatchObject({ backup: { lastSuccessAt: '2026-11-11T01:38:52Z' } });
    });

    it('reports null while no backup has succeeded (no file, or an empty one)', async () => {
      rmSync(file, { force: true });
      expect(await health(app)).toMatchObject({ backup: { lastSuccessAt: null } });

      writeFileSync(file, '');
      expect(await health(app)).toMatchObject({ backup: { lastSuccessAt: null } });
    });

    it('reports null for a file that is not an instant', async () => {
      writeFileSync(file, 'hier soir\n');
      expect(await health(app)).toMatchObject({ backup: { lastSuccessAt: null } });
    });
  });
});
