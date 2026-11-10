import type { INestApplication } from '@nestjs/common';
import { zScenarioRun } from '@crewdeck/contracts';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { type Env, parseEnv } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** The database's catalogue and the statements the reset sends to it, without PostgreSQL. */
const fakeDatabase = (tables: string[]) => {
  const statements: string[] = [];
  return {
    statements,
    prisma: {
      $queryRaw: () => Promise.resolve(tables.map((tablename) => ({ tablename }))),
      $executeRawUnsafe: (sql: string) => {
        statements.push(sql);
        return Promise.resolve(0);
      },
      $disconnect: () => Promise.resolve(),
    },
  };
};

const boot = async (nodeEnv: Env['NODE_ENV'], database = fakeDatabase([])): Promise<INestApplication> => {
  const env = parseEnv({ NODE_ENV: nodeEnv, DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck' });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env, { logs: false })] })
    .overrideProvider(PrismaService)
    .useValue(database.prisma)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  return app;
};

const post = async (app: INestApplication, name: string): Promise<Response> =>
  fetch(`${await app.getUrl()}/api/testing/scenarios/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });

describe('POST /api/testing/scenarios/:name', () => {
  describe.each(['development', 'test'] as const)('with NODE_ENV=%s', (nodeEnv) => {
    let app: INestApplication;
    const database = fakeDatabase(['ideas', 'pilots']);

    beforeAll(async () => {
      app = await boot(nodeEnv, database);
    });

    afterAll(() => app.close());

    it('runs the blank scenario and returns its path, without a session', async () => {
      const response = await post(app, 'blank');

      expect(response.status).toBe(200);
      expect(zScenarioRun.parse(await response.json())).toEqual({ name: 'blank', path: '/', sessionCookie: null });
    });

    it('first empties every data table', async () => {
      database.statements.length = 0;

      await post(app, 'blank');

      expect(database.statements).toEqual(['TRUNCATE TABLE "ideas", "pilots" RESTART IDENTITY CASCADE']);
    });

    it('gives 404 testing.unknown-scenario for an unknown name', async () => {
      const response = await post(app, 'nope');

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        status: 404,
        code: 'testing.unknown-scenario',
        message: 'Scénario de test inconnu : « nope ».',
      });
    });
  });

  it('does not exist with NODE_ENV=production', async () => {
    const database = fakeDatabase(['ideas']);
    const app = await boot('production', database);

    const response = await post(app, 'blank');
    await app.close();

    expect(response.status).toBe(404);
    expect(database.statements).toEqual([]);
  });
});
