/**
 * The global models (ADR 0008): the only ones without `pilotId`, never
 * rewritten by `pilotScope`. Every other model is scoped, and the models walk
 * of `scope.models.spec.ts` fails when one lacks a `pilotId` led index, or
 * points at another scoped model by a foreign key without `pilotId`.
 */
export const GLOBAL_MODELS: ReadonlySet<string> = new Set(['Pilot', 'GitHubDelivery', 'GitHubInstallation', 'FxRate']);

export const PILOT_ID = 'pilotId';

/** A field as Prisma's DMMF has it: a relation is `kind: 'object'`, its `type` the other model, its foreign key in `relationFromFields`. */
export interface DatamodelField {
  readonly name: string;
  readonly kind?: string;
  readonly type?: string;
  readonly relationFromFields?: readonly string[];
  readonly relationToFields?: readonly string[];
  readonly relationName?: string | null;
}

/** The part of Prisma's DMMF the walk reads (`getDMMF().datamodel`). */
export interface DatamodelShape {
  readonly models: readonly { readonly name: string; readonly fields: readonly DatamodelField[] }[];
  readonly indexes: readonly { readonly model: string; readonly fields: readonly { readonly name: string }[] }[];
}

/** The foreign key of `field` maps `pilotId` to `pilotId`: the row it points at is the same Pilote's. */
const carriesPilotId = (field: DatamodelField): boolean => {
  const at = field.relationFromFields?.indexOf(PILOT_ID) ?? -1;
  return at >= 0 && field.relationToFields?.[at] === PILOT_ID;
};

const holdsKey = (field: DatamodelField): boolean => (field.relationFromFields?.length ?? 0) > 0;

/**
 * The models that break the scope's rule, each with why: neither global, nor
 * with a `pilotId` field and an index (or a primary or unique key) whose first
 * column is `pilotId`; or holding a foreign key to another scoped model that
 * does not carry `pilotId` (PostgreSQL then lets a row point at another
 * Pilote's, which an `include` would read), or an implicit many-to-many to
 * one, whose join table Prisma writes without `pilotId`. Empty when the
 * schema is safe.
 */
export const unscopedModels = (datamodel: DatamodelShape, globals: ReadonlySet<string> = GLOBAL_MODELS): string[] =>
  datamodel.models
    .filter((model) => !globals.has(model.name))
    .flatMap((model) => {
      if (!model.fields.some((field) => field.name === PILOT_ID)) return [`${model.name}: no ${PILOT_ID} field`];
      const led = datamodel.indexes.some((index) => index.model === model.name && index.fields[0]?.name === PILOT_ID);
      const toScoped = model.fields.filter((field) => field.kind === 'object' && field.type && !globals.has(field.type));
      const foreign = toScoped
        .filter((field) => holdsKey(field) && !carriesPilotId(field))
        .map((field) => `${model.name}.${field.name}: relation to the scoped ${field.type} without ${PILOT_ID} in its foreign key`);
      // Neither side holds the key: Prisma keeps the links in a join table of its own.
      const implicit = toScoped
        .filter((field) => !holdsKey(field))
        .filter((field) => {
          // The other side: same relation name and back to this model (a name may be reused by other pairs).
          const other = datamodel.models
            .find((candidate) => candidate.name === field.type)
            ?.fields.find(
              (candidate) =>
                candidate !== field && candidate.kind === 'object' && candidate.type === model.name && candidate.relationName === field.relationName,
            );
          // No other side found: reported rather than trusted.
          return other === undefined || !holdsKey(other);
        })
        .map(
          (field) =>
            `${model.name}.${field.name}: implicit many-to-many relation to the scoped ${field.type}, its join table has no ${PILOT_ID}: write an explicit join model`,
        );
      return [...(led ? [] : [`${model.name}: no index starting with ${PILOT_ID}`]), ...foreign, ...implicit];
    });
