import { runInPilotScope, ScopeMissingError } from './scope.context.js';
import { pilotScope, ScopeViolationError } from './prisma-scope.extension.js';

type Args = Record<string, unknown>;

/**
 * Runs the extension on a fake query of `model` (no database): returns the
 * arguments it hands on to Prisma.
 */
const rewrite = async (model: string, operation: string, args: Args): Promise<Args> => {
  const query = vi.fn(async (rewritten: Args) => rewritten);
  await pilotScope.query.$allModels.$allOperations({ model, operation, args, query } as never);
  expect(query).toHaveBeenCalledTimes(1);
  return query.mock.calls[0]?.[0] as Args;
};

const inP1 = <T>(fn: () => Promise<T>): Promise<T> => runInPilotScope('p1', fn);

describe('pilotScope, on a scoped model', () => {
  it('adds where.pilotId to a findMany inside the scope', async () => {
    const args = await inP1(() => rewrite('Ticket', 'findMany', { where: { state: 'open' }, take: 10 }));

    expect(args).toEqual({ where: { state: 'open', pilotId: 'p1' }, take: 10 });
  });

  it('adds where.pilotId when the query has no where', async () => {
    expect(await inP1(() => rewrite('Ticket', 'findMany', {}))).toEqual({ where: { pilotId: 'p1' } });
  });

  it.each([
    'findUnique',
    'findUniqueOrThrow',
    'findFirst',
    'findFirstOrThrow',
    'count',
    'aggregate',
    'groupBy',
    'delete',
    'deleteMany',
  ])('adds where.pilotId to %s', async (operation) => {
    const args = await inP1(() => rewrite('Ticket', operation, { where: { id: 't1' } }));

    expect(args['where']).toEqual({ id: 't1', pilotId: 'p1' });
  });

  it('sets data.pilotId on a create', async () => {
    const args = await inP1(() => rewrite('Ticket', 'create', { data: { title: 'Un ticket' } }));

    expect(args).toEqual({ data: { title: 'Un ticket', pilotId: 'p1' } });
  });

  it.each(['createMany', 'createManyAndReturn'])('sets data.pilotId on every row of %s', async (operation) => {
    const args = await inP1(() => rewrite('Ticket', operation, { data: [{ title: 'A' }, { title: 'B' }] }));

    expect(args['data']).toEqual([
      { title: 'A', pilotId: 'p1' },
      { title: 'B', pilotId: 'p1' },
    ]);
  });

  it.each(['update', 'updateMany', 'updateManyAndReturn'])('scopes the where of %s and keeps its data', async (operation) => {
    const args = await inP1(() => rewrite('Ticket', operation, { where: { id: 't1' }, data: { title: 'Nouveau' } }));

    expect(args).toEqual({ where: { id: 't1', pilotId: 'p1' }, data: { title: 'Nouveau' } });
  });

  it('scopes the where of an upsert and sets the pilotId of its create', async () => {
    const args = await inP1(() =>
      rewrite('Ticket', 'upsert', { where: { id: 't1' }, create: { id: 't1', title: 'A' }, update: { title: 'B' } }),
    );

    expect(args).toEqual({ where: { id: 't1', pilotId: 'p1' }, create: { id: 't1', title: 'A', pilotId: 'p1' }, update: { title: 'B' } });
  });

  it('accepts the scope’s own pilotId given explicitly', async () => {
    const args = await inP1(() => rewrite('Ticket', 'create', { data: { title: 'A', pilotId: 'p1' } }));

    expect(args).toEqual({ data: { title: 'A', pilotId: 'p1' } });
  });

  it('throws ScopeMissingError outside any scope', async () => {
    await expect(rewrite('Ticket', 'findMany', {})).rejects.toBeInstanceOf(ScopeMissingError);
  });

  it.each([
    ['findMany', { where: { pilotId: 'p2' } }],
    ['findFirst', { where: { pilotId: { in: ['p1', 'p2'] } } }],
    ['create', { data: { title: 'A', pilotId: 'p2' } }],
    ['createMany', { data: [{ title: 'A' }, { title: 'B', pilotId: 'p2' }] }],
    ['update', { where: { id: 't1' }, data: { pilotId: 'p2' } }],
    ['updateMany', { where: { pilotId: 'p2' }, data: { title: 'B' } }],
    ['upsert', { where: { id: 't1' }, create: { pilotId: 'p2' }, update: {} }],
    ['upsert', { where: { id: 't1' }, create: {}, update: { pilotId: 'p2' } }],
    ['create', { data: { title: 'A', pilot: { connect: { id: 'p2' } } } }],
  ])('throws on %s given another pilotId (%j)', async (operation, args) => {
    await expect(inP1(() => rewrite('Ticket', operation, args))).rejects.toBeInstanceOf(ScopeViolationError);
  });

  it('throws on an operation it does not know, rather than letting it through unscoped', async () => {
    await expect(inP1(() => rewrite('Ticket', 'findEverything', {}))).rejects.toBeInstanceOf(ScopeViolationError);
  });
});

describe('pilotScope, on a global model', () => {
  it('leaves a query of Pilot as is, inside or outside a scope', async () => {
    const args = { where: { login: 'octocat' } };

    expect(await rewrite('Pilot', 'findMany', args)).toEqual({ where: { login: 'octocat' } });
    expect(await inP1(() => rewrite('Pilot', 'create', { data: { login: 'octocat' } }))).toEqual({ data: { login: 'octocat' } });
  });
});
