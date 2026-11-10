import { parseEnv } from '../config/env.js';
import { runtimeModels, ScopeViolationError } from '../scope/prisma-scope.extension.js';
import { withPilotScope } from '../scope/scope.context.js';
import { PrismaService } from './prisma.service.js';

describe('PrismaService', () => {
  // Port 1: nothing listens, so nothing reaches a database.
  const prisma = new PrismaService(parseEnv({ DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck' }));

  afterAll(() => prisma.onModuleDestroy());

  it('finds the relations of each model on the generated client', () => {
    const pilot = runtimeModels(prisma.unscoped)['Pilot'];

    expect(pilot?.fields).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'id', kind: 'scalar' })]));
  });

  it('throws when the client has no runtime data model', () => {
    expect(() => runtimeModels({})).toThrow(/runtime data model/);
  });

  it.each([
    ['$queryRaw', () => prisma.scoped.$queryRaw`SELECT 1`],
    ['$executeRaw', () => prisma.scoped.$executeRaw`SELECT 1`],
    ['$queryRawUnsafe', () => prisma.scoped.$queryRawUnsafe('SELECT 1')],
    ['$executeRawUnsafe', () => prisma.scoped.$executeRawUnsafe('SELECT 1')],
  ])('refuses %s on the scoped client, outside and inside a scope', async (_name, run) => {
    await expect(run()).rejects.toBeInstanceOf(ScopeViolationError);
    await expect(withPilotScope('p1', run)).rejects.toBeInstanceOf(ScopeViolationError);
  });

  it('leaves raw SQL to the unscoped client', async () => {
    const error: unknown = await prisma.unscoped.$queryRaw`SELECT 1`.catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ScopeViolationError);
  });
});
