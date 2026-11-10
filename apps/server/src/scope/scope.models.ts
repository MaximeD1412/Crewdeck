/**
 * The global models (ADR 0008): the only ones without `pilotId`, never
 * rewritten by `pilotScope`. Every other model is scoped, and the models walk
 * of `scope.models.spec.ts` fails when one lacks a `pilotId` led index.
 * Later: `FxRate`, `GithubInstallation`, `WebhookDelivery`.
 */
export const GLOBAL_MODELS: ReadonlySet<string> = new Set(['Pilot']);

export const PILOT_ID = 'pilotId';

export const isScopedModel = (model: string): boolean => !GLOBAL_MODELS.has(model);

/** The part of Prisma's DMMF the walk reads (`getDMMF().datamodel`). */
export interface DatamodelShape {
  readonly models: readonly { readonly name: string; readonly fields: readonly { readonly name: string }[] }[];
  readonly indexes: readonly { readonly model: string; readonly fields: readonly { readonly name: string }[] }[];
}

/**
 * The models that break the scope's rule, each with why: neither global, nor
 * with a `pilotId` field and an index (or a primary or unique key) whose first
 * column is `pilotId`. Empty when the schema is safe.
 */
export const unscopedModels = (datamodel: DatamodelShape, globals: ReadonlySet<string> = GLOBAL_MODELS): string[] =>
  datamodel.models
    .filter((model) => !globals.has(model.name))
    .flatMap((model) => {
      if (!model.fields.some((field) => field.name === PILOT_ID)) return [`${model.name}: no ${PILOT_ID} field`];
      const led = datamodel.indexes.some((index) => index.model === model.name && index.fields[0]?.name === PILOT_ID);
      return led ? [] : [`${model.name}: no index starting with ${PILOT_ID}`];
    });
