import { isScopedModel, PILOT_ID } from './scope.models.js';
import { currentPilotId } from './scope.context.js';

type Args = Record<string, unknown>;

/** A query asking for another Pilote's rows, or moving rows to another Pilote: a bug, a 500. */
export class ScopeViolationError extends Error {
  constructor(model: string, operation: string, reason: string) {
    super(`${model}.${operation}: ${reason}`);
    this.name = 'ScopeViolationError';
  }
}

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

/** The operations whose `data` (or `create`) writes new rows. */
const CREATING = new Set(['create', 'createMany', 'createManyAndReturn']);

const isObject = (value: unknown): value is Args => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The Prisma client extension of ADR 0008: on every scoped model, `where`
 * gets the current Pilote's `pilotId` and every new row gets it in `data`;
 * outside a scope it throws `ScopeMissingError`, and a query naming another
 * `pilotId` (or the `pilot` relation) throws `ScopeViolationError`. An
 * operation it does not know throws too: nothing runs unscoped by omission.
 * Nested writes are not rewritten: Prisma requires their `pilotId` explicitly.
 */
export const pilotScope = {
  name: 'pilot-scope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }: { model: string; operation: string; args: Args; query: (args: Args) => Promise<unknown> }) {
        if (!isScopedModel(model)) return query(args);
        const pilotId = currentPilotId();
        const fail = (reason: string): never => {
          throw new ScopeViolationError(model, operation, reason);
        };

        /** `row` with the scope's `pilotId`; throws when it names another one. */
        const own = (row: unknown, part: string): Args => {
          const value = isObject(row) ? row : {};
          if ('pilot' in value) fail(`${part}.pilot is set by the scope, give no relation to a Pilote`);
          if (PILOT_ID in value && value[PILOT_ID] !== pilotId) fail(`${part}.${PILOT_ID} is not the scope's Pilote`);
          return { ...value, [PILOT_ID]: pilotId };
        };
        /** `data` of an update: it may not move the row to another Pilote. */
        const kept = (data: unknown, part: string): unknown => {
          if (isObject(data)) {
            if ('pilot' in data) fail(`${part}.pilot cannot change`);
            if (PILOT_ID in data && data[PILOT_ID] !== pilotId) fail(`${part}.${PILOT_ID} cannot change`);
          }
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
      },
    },
  },
};
