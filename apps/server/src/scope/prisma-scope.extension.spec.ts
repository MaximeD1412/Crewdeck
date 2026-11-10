import { pilotScope, type RuntimeModels, ScopeViolationError } from './prisma-scope.extension.js';
import { runInPilotScope, ScopeMissingError } from './scope.context.js';

type Args = Record<string, unknown>;

const scalar = (name: string, type = 'String') => ({ name, kind: 'scalar', type });
const relation = (name: string, type: string) => ({ name, kind: 'object', type });

/** Pilot, Installation and Account are global; Ticket, Comment and Runner are scoped. */
const MODELS: RuntimeModels = {
  Pilot: { fields: [scalar('id'), scalar('login'), relation('tickets', 'Ticket'), relation('installations', 'Installation'), relation('runner', 'Runner')] },
  Ticket: {
    fields: [
      scalar('id'),
      scalar('pilotId'),
      scalar('title'),
      scalar('state'),
      scalar('payload', 'Json'),
      relation('pilot', 'Pilot'),
      relation('comments', 'Comment'),
      relation('installation', 'Installation'),
    ],
  },
  Comment: { fields: [scalar('id'), scalar('pilotId'), scalar('ticketId'), relation('ticket', 'Ticket')] },
  Runner: { fields: [scalar('id'), scalar('pilotId'), relation('pilot', 'Pilot')] },
  Installation: { fields: [scalar('id'), relation('tickets', 'Ticket'), relation('owner', 'Account')] },
  Account: { fields: [scalar('id'), relation('installations', 'Installation')] },
};
const extension = pilotScope(MODELS, new Set(['Pilot', 'Installation', 'Account']));

/**
 * Runs the extension on a fake query of `model` (no database): returns the
 * arguments it hands on to Prisma.
 */
const rewrite = async (model: string, operation: string, args: Args): Promise<Args> => {
  const query = vi.fn(async (rewritten: Args) => rewritten);
  await extension.query.$allModels.$allOperations({ model, operation, args, query } as never);
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
    ['create', { data: { title: 'A', pilotId: 'p1', pilot: { connect: { id: 'p1' } } } }],
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

describe('pilotScope, on the relations of a scoped model', () => {
  it.each([
    ['create', { data: { title: 'A', comments: { create: { pilotId: 'p2' } } } }],
    ['create', { data: { title: 'A', comments: { create: [{ pilotId: 'p1' }] } } }],
    ['create', { data: { title: 'A', comments: { connect: { id: 'c-of-p2' } } } }],
    ['create', { data: { title: 'A', installation: { connectOrCreate: { where: { id: 'i1' }, create: { id: 'i1' } } } } }],
    ['update', { where: { id: 't1' }, data: { comments: { createMany: { data: [{ pilotId: 'p2' }] } } } }],
    ['update', { where: { id: 't1' }, data: { comments: { set: [{ id: 'c-of-p2' }] } } }],
    ['updateMany', { where: {}, data: { comments: { deleteMany: {} } } }],
    ['upsert', { where: { id: 't1' }, create: { comments: { create: { pilotId: 'p2' } } }, update: {} }],
    ['upsert', { where: { id: 't1' }, create: {}, update: { comments: { connect: { id: 'c-of-p2' } } } }],
  ])('refuses the nested write of %s (%j): each model is written on its own', async (operation, args) => {
    await expect(inP1(() => rewrite('Ticket', operation, args))).rejects.toBeInstanceOf(ScopeViolationError);
  });

  it('tells a relation from a Json field by the model, not by the value’s shape', async () => {
    const args = await inP1(() => rewrite('Ticket', 'create', { data: { title: 'A', payload: { create: { pilotId: 'p2' } } } }));

    expect(args['data']).toEqual({ title: 'A', payload: { create: { pilotId: 'p2' } }, pilotId: 'p1' });
  });

  it('lets it read its own relations, scoped or global, and filter on them', async () => {
    const query = {
      where: { comments: { some: { id: 'c1' } }, installation: { is: { id: 'i1' } } },
      include: { comments: { where: { id: 'c1' } }, pilot: true, installation: { include: { owner: true } } },
    };

    const args = await inP1(() => rewrite('Ticket', 'findMany', query));

    expect(args).toEqual({ ...query, where: { ...query.where, pilotId: 'p1' } });
  });

  it('refuses a scoped relation reached through a global one: another Pilote’s rows', async () => {
    await expect(
      inP1(() => rewrite('Ticket', 'findMany', { include: { installation: { include: { tickets: true } } } })),
    ).rejects.toBeInstanceOf(ScopeViolationError);
    await expect(
      inP1(() => rewrite('Ticket', 'findMany', { where: { installation: { is: { tickets: { some: {} } } } } })),
    ).rejects.toBeInstanceOf(ScopeViolationError);
  });
});

describe('pilotScope, on the relations of a global model', () => {
  it.each([
    ['findMany', { include: { tickets: true } }],
    ['findMany', { select: { id: true, tickets: { select: { title: true } } } }],
    ['findMany', { include: { installations: { include: { tickets: true } } } }],
    ['findMany', { select: { _count: true } }],
    ['findMany', { include: { _count: { select: { tickets: true } } } }],
    ['findMany', { where: { tickets: { some: { title: 'A' } } } }],
    ['findMany', { where: { OR: [{ login: 'a' }, { tickets: { none: {} } }] } }],
    ['findMany', { orderBy: [{ tickets: { _count: 'desc' } }] }],
    ['findMany', { where: { id: 'p2', runner: null } }],
    ['findFirst', { where: { AND: [{ id: 'p2' }, { runner: { isNot: null } }] } }],
    ['findMany', { select: { _count: { select: { installations: { where: { tickets: { some: {} } } } } } } }],
    ['findMany', { include: { _count: { select: { installations: { where: { OR: [{ tickets: { none: {} } }] } } } } } }],
    ['count', { where: { NOT: { tickets: { every: { state: 'open' } } } } }],
    ['create', { data: { login: 'a', tickets: { create: { title: 'A' } } } }],
    ['update', { where: { id: 'p1' }, data: { tickets: { deleteMany: {} } } }],
    ['upsert', { where: { id: 'p1' }, create: { tickets: { create: {} } }, update: {} }],
  ])('refuses %s reaching a scoped relation (%j), inside a scope or not', async (operation, args) => {
    await expect(rewrite('Pilot', operation, args)).rejects.toBeInstanceOf(ScopeViolationError);
    await expect(inP1(() => rewrite('Pilot', operation, args))).rejects.toBeInstanceOf(ScopeViolationError);
  });

  it('lets it reach its global relations', async () => {
    const args = {
      include: {
        installations: { include: { owner: true }, where: { owner: { is: { id: 'a1' } } } },
        _count: { select: { installations: { where: { owner: null } } } },
      },
    };

    expect(await rewrite('Pilot', 'findMany', args)).toEqual(args);
    expect(await rewrite('Installation', 'findMany', { select: { _count: { select: { owner: true } } } })).toEqual({ select: { _count: { select: { owner: true } } } });
  });
});

describe('pilotScope, on raw SQL', () => {
  it.each(['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe'] as const)(
    'refuses %s, inside a scope or not: it would read every Pilote’s tables',
    async (operation) => {
      const query = vi.fn();
      const run = () => extension.query[operation]({ args: ['SELECT 1'], query } as never);

      await expect(run()).rejects.toBeInstanceOf(ScopeViolationError);
      await expect(inP1(run)).rejects.toBeInstanceOf(ScopeViolationError);
      expect(query).not.toHaveBeenCalled();
    },
  );
});
