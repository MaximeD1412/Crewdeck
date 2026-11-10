import { currentPilotId } from './scope.context.js';
import { GLOBAL_MODELS, PILOT_ID } from './scope.models.js';

type Args = Record<string, unknown>;

/** The fields of each model, as Prisma's runtime data model has them: a relation is `kind: 'object'`, its `type` the other model. */
export interface RuntimeModels {
  readonly [model: string]: { readonly fields: readonly { readonly name: string; readonly kind: string; readonly type: string }[] };
}

/** A query asking for another Pilote's rows, or able to reach them: a bug, a 500. */
export class ScopeViolationError extends Error {
  constructor(model: string, operation: string, reason: string) {
    super(`${model}.${operation}: ${reason}`);
    this.name = 'ScopeViolationError';
  }
}

/**
 * The models of `client`, read from Prisma's runtime data model (Prisma 7
 * exports no DMMF): `pilotScope` needs to tell a relation from a scalar or a
 * Json field. Throws when a Prisma upgrade moves it, rather than letting the
 * relations through unseen.
 */
export const runtimeModels = (client: object): RuntimeModels => {
  const models = (client as { _runtimeDataModel?: { models?: RuntimeModels } })._runtimeDataModel?.models;
  if (!models) throw new Error('Prisma’s runtime data model is not on the client: pilotScope cannot see the relations.');
  return models;
};

/** The operations whose `where` selects the rows read, changed or deleted. */
const FILTERED = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

/** The operations whose `data` writes new rows. */
const CREATING = new Set(['create', 'createMany', 'createManyAndReturn']);

/** The raw SQL of the client: no model, so no scope to add. */
const RAW = ['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe'] as const;

/** The keys of a relation filter, each holding a filter of the related model. */
const RELATION_FILTERS = ['is', 'isNot', 'some', 'every', 'none'];

const isObject = (value: unknown): value is Args => typeof value === 'object' && value !== null && !Array.isArray(value);

const each = (value: unknown, fn: (item: unknown) => void): void => {
  if (Array.isArray(value)) value.forEach(fn);
  else fn(value);
};

/**
 * The Prisma client extension of ADR 0008. On every scoped model, `where`
 * gets the current Pilote's `pilotId` and every new row gets it in `data`;
 * outside a scope it throws `ScopeMissingError`. It throws
 * `ScopeViolationError`, rather than run, for what the scope cannot guarantee:
 * - a query naming another `pilotId`, or an operation it does not know;
 * - a nested write (`create`, `connect`, `set`… in a relation of `data`), on
 *   any model: each model is written on its own, in a transaction;
 * - a global model reaching a scoped relation (`include`, `select`,
 *   `_count`, `where`, `orderBy`), which would read every Pilote's rows;
 * - raw SQL, which no model scopes: `prisma.unscoped`, where ESLint allows it.
 */
export const pilotScope = (models: RuntimeModels, globals: ReadonlySet<string> = GLOBAL_MODELS) => {
  const isScoped = (model: string): boolean => !globals.has(model);

  const refuseRaw =
    (operation: string): ((params: unknown) => Promise<never>) =>
    async () => {
      throw new ScopeViolationError('client', operation, 'raw SQL skips the scope of a Pilote: use prisma.unscoped where ESLint allows it');
    };

  async function $allOperations({
    model,
    operation,
    args,
    query,
  }: {
    model: string;
    operation: string;
    args: Args;
    query: (args: Args) => Promise<unknown>;
  }): Promise<unknown> {
    const fail = (reason: string): never => {
      throw new ScopeViolationError(model, operation, reason);
    };
    const relationsOf = (name: string): ReadonlyMap<string, string> => {
      const fields = models[name]?.fields ?? fail(`unknown model ${name}`);
      return new Map(fields.filter((field) => field.kind === 'object').map((field) => [field.name, field.type]));
    };
    /** `from.key` leads to `target`: refused from a global model to a scoped one. */
    const reach = (from: string, key: string, target: string): void => {
      if (!isScoped(from) && isScoped(target)) fail(`${from}.${key} reaches the scoped ${target} from a global model`);
    };

    const checkWhere = (name: string, where: unknown): void => {
      if (Array.isArray(where)) return where.forEach((item) => checkWhere(name, item));
      if (!isObject(where)) return;
      const relations = relationsOf(name);
      for (const [key, value] of Object.entries(where)) {
        if (key === 'AND' || key === 'OR' || key === 'NOT') {
          checkWhere(name, value);
          continue;
        }
        const target = relations.get(key);
        if (!target) continue;
        // Before the value's shape: `runner: null` filters on the relation too.
        reach(name, key, target);
        if (!isObject(value)) continue;
        const filters = RELATION_FILTERS.filter((filter) => filter in value);
        if (filters.length === 0) checkWhere(target, value);
        for (const filter of filters) checkWhere(target, value[filter]);
      }
    };

    const checkOrderBy = (name: string, orderBy: unknown): void => {
      if (Array.isArray(orderBy)) return orderBy.forEach((item) => checkOrderBy(name, item));
      if (!isObject(orderBy)) return;
      const relations = relationsOf(name);
      for (const [key, value] of Object.entries(orderBy)) {
        const target = relations.get(key);
        if (!target) continue;
        reach(name, key, target);
        checkOrderBy(target, value);
      }
    };

    const checkSelection = (name: string, selection: unknown): void => {
      if (!isObject(selection)) return;
      const relations = relationsOf(name);
      for (const [key, value] of Object.entries(selection)) {
        if (key === '_count') {
          if (value === true) for (const [relation, target] of relations) reach(name, relation, target);
          if (isObject(value) && isObject(value['select'])) {
            for (const [relation, counted] of Object.entries(value['select'])) {
              const target = relations.get(relation);
              if (!target) continue;
              reach(name, relation, target);
              // A filtered count (`{ where }`) tells about the rows it filters on.
              if (isObject(counted)) checkWhere(target, counted['where']);
            }
          }
          continue;
        }
        const target = relations.get(key);
        if (!target) continue;
        reach(name, key, target);
        if (!isObject(value)) continue;
        checkSelection(target, value['include']);
        checkSelection(target, value['select']);
        checkWhere(target, value['where']);
        checkOrderBy(target, value['orderBy']);
      }
    };

    /** `data` (a row, or rows) holds no relation: no nested write. */
    const checkData = (data: unknown, part: string): void => {
      const relations = relationsOf(model);
      each(data, (row) => {
        if (!isObject(row)) return;
        const nested = Object.keys(row).find((key) => relations.has(key));
        if (nested) fail(`${part}.${nested} is a nested write: write each model on its own, in a transaction`);
      });
    };

    checkWhere(model, args['where']);
    checkSelection(model, args['include']);
    checkSelection(model, args['select']);
    checkOrderBy(model, args['orderBy']);
    for (const part of ['data', 'create', 'update']) if (part in args) checkData(args[part], part);

    if (!isScoped(model)) return query(args);
    const pilotId = currentPilotId();

    /** `row` with the scope's `pilotId`; throws when it names another one. */
    const own = (row: unknown, part: string): Args => {
      const value = isObject(row) ? row : {};
      if (PILOT_ID in value && value[PILOT_ID] !== pilotId) fail(`${part}.${PILOT_ID} is not the scope's Pilote`);
      return { ...value, [PILOT_ID]: pilotId };
    };
    /** `data` of an update: it may not move the row to another Pilote. */
    const kept = (data: unknown, part: string): unknown => {
      if (isObject(data) && PILOT_ID in data && data[PILOT_ID] !== pilotId) fail(`${part}.${PILOT_ID} cannot change`);
      return data;
    };

    if (CREATING.has(operation)) {
      const data = Array.isArray(args['data']) ? args['data'].map((row) => own(row, 'data')) : own(args['data'], 'data');
      return query({ ...args, data });
    }
    if (!FILTERED.has(operation)) return fail('unknown operation on a scoped model');

    const rewritten: Args = { ...args, where: own(args['where'], 'where') };
    if ('data' in args) rewritten['data'] = kept(args['data'], 'data');
    if (operation === 'upsert') {
      rewritten['create'] = own(args['create'], 'create');
      rewritten['update'] = kept(args['update'], 'update');
    }
    return query(rewritten);
  }

  return {
    name: 'pilot-scope',
    query: {
      $allModels: { $allOperations },
      ...(Object.fromEntries(RAW.map((operation) => [operation, refuseRaw(operation)])) as Record<(typeof RAW)[number], (params: unknown) => Promise<never>>),
    },
  };
};
