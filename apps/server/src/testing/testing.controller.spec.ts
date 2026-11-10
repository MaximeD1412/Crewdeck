import type { INestApplication } from '@nestjs/common';
import { zScenarioRun } from '@crewdeck/contracts';
import { Test } from '@nestjs/testing';
import { applyGlobalPrefix } from '../app.js';
import { AppModule } from '../app.module.js';
import { type Env, parseEnv } from '../config/env.js';
import { FAKES, type Fakes } from './fakes.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** The database's catalogue and the statements the reset sends to it, without PostgreSQL. */
const fakeDatabase = (tables: string[]) => {
  const statements: string[] = [];
  return {
    statements,
    prisma: {
      unscoped: {
        $queryRaw: () => Promise.resolve(tables.map((tablename) => ({ tablename }))),
        $executeRawUnsafe: (sql: string) => {
          statements.push(sql);
          return Promise.resolve(0);
        },
      },
    },
  };
};

const boot = async (nodeEnv: Env['NODE_ENV'], database = fakeDatabase([]), fakes = true): Promise<INestApplication> => {
  const env = parseEnv({
    CREWDECK_ENV: 'test',
    NODE_ENV: nodeEnv,
    DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck',
    ...(fakes ? { CREWDECK_FAKES: '1' } : {}),
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env, { logs: false })] })
    .overrideProvider(PrismaService)
    .useValue(database.prisma)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  applyGlobalPrefix(app);
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
  describe.each(['development', 'test'] as const)('with CREWDECK_FAKES=1 and NODE_ENV=%s', (nodeEnv) => {
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

    it('first resets the fake GitHub', async () => {
      const { github } = app.get<Fakes>(FAKES);
      github.seedRepo({ owner: 'o', name: 'r' });

      await post(app, 'blank');

      expect(github.fileAt('o', 'r', 'main', 'README.md')).toBeUndefined();
      await expect(github.getDefaultBranch({ owner: 'o', name: 'r', id: 1 })).rejects.toMatchObject({ code: 'github.unavailable' });
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

  it.each(['development', 'production'] as const)('does not exist without CREWDECK_FAKES (NODE_ENV=%s)', async (nodeEnv) => {
    const database = fakeDatabase(['ideas']);
    const app = await boot(nodeEnv, database, false);

    const response = await post(app, 'blank');
    await app.close();

    expect(response.status).toBe(404);
    expect(database.statements).toEqual([]);
  });
});
