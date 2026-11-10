import { inject } from 'vitest';
import { parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { ScopeViolationError } from '../../src/scope/prisma-scope.extension.js';
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

  it('refuses raw SQL in a transaction of the scoped client, and leaves it to the unscoped one', async () => {
    const inTransaction = prisma.scoped.$transaction(async (tx) => tx.$queryRaw`SELECT 1`);
    const inScope = runInPilotScope(newId(), () => prisma.scoped.$transaction(async (tx) => tx.$executeRawUnsafe('SELECT 1')));

    await expect(inTransaction).rejects.toBeInstanceOf(ScopeViolationError);
    await expect(inScope).rejects.toBeInstanceOf(ScopeViolationError);
    await expect(prisma.unscoped.$queryRaw`SELECT 1 AS one`).resolves.toEqual([{ one: 1 }]);
  });
});
