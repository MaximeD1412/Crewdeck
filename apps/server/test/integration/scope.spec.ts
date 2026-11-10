import { inject } from 'vitest';
import { parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';

const databaseUrl = inject('databaseUrl');

describe('prisma.scoped against PostgreSQL', () => {
  const prisma = new PrismaService(parseEnv({ DATABASE_URL: databaseUrl }));

  afterAll(() => prisma.onModuleDestroy());

  it('leaves the global Pilot as is, outside a scope and in another Pilote’s', async () => {
    const id = newId();
    await prisma.scoped.pilot.create({ data: { id, githubUserId: 583231n, login: 'octocat', timeZone: 'Europe/Paris' } });

    const outside = await prisma.scoped.pilot.findUnique({ where: { id } });
    const inAnother = await runInPilotScope(newId(), () => prisma.scoped.pilot.findMany({ where: { id } }));

    expect(outside).toMatchObject({ id, githubUserId: 583231n, login: 'octocat', timeZone: 'Europe/Paris', seq: 0n });
    expect(outside?.createdAt).toBeInstanceOf(Date);
    expect(inAnother.map((pilot) => pilot.id)).toEqual([id]);
  });
});
