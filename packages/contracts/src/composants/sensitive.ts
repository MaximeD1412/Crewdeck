import type { z } from 'zod';
import { type SensitiveActionId, zSensitiveActionId } from '../api/sensitive-actions.js';

export type { SensitiveActionId } from '../api/sensitive-actions.js';

/** A Composant's action declared as an Action sensible: its payload schema, and which one it is. */
export interface SensitiveActionDeclaration<Id extends SensitiveActionId = SensitiveActionId, S extends z.ZodType = z.ZodType> {
  readonly schema: S;
  readonly sensitive: Id;
}

/** What a Composant declares for one of its actions: its payload schema, or `sensitive(id, schema)`. */
export type ActionDeclaration = z.ZodType | SensitiveActionDeclaration;

/** The payload schema of a declared action. */
export type ActionSchemaOf<D> = D extends SensitiveActionDeclaration<SensitiveActionId, infer S> ? S : D extends z.ZodType ? D : never;

/**
 * Declares one of a Composant's actions as an Action sensible
 * (`actions: { approve: sensitive('document.approve', z.object({ id: zId })) }`):
 * the core then opens its own confirmation before running it, and refuses it
 * during the Resynchronisation. The library page shows it « Action sensible ».
 */
export const sensitive = <const Id extends SensitiveActionId, S extends z.ZodType>(
  id: Id,
  schema: S,
): SensitiveActionDeclaration<Id, S> => {
  if (!zSensitiveActionId.safeParse(id).success) throw new Error(`Action sensible ${String(id)} inconnue`);
  return Object.freeze({ schema, sensitive: id });
};

const isSensitive = (declaration: ActionDeclaration): declaration is SensitiveActionDeclaration =>
  typeof (declaration as Partial<SensitiveActionDeclaration>).sensitive === 'string' && 'schema' in declaration;

/** The payload schema of a declared action, sensitive or not. */
export const actionSchema = <D extends ActionDeclaration>(declaration: D): ActionSchemaOf<D> =>
  (isSensitive(declaration) ? declaration.schema : declaration) as ActionSchemaOf<D>;

/** The Action sensible a declared action is, `null` for a free one. */
export const sensitiveActionOf = (declaration: ActionDeclaration): SensitiveActionId | null =>
  isSensitive(declaration) ? declaration.sensitive : null;
