import {
  COMPOSANT_CATEGORIES,
  composantKeys,
  fr,
  t,
  type AnyComposant,
  type ComposantData,
  type MessageKey,
  type PageComposants,
} from '@crewdeck/sdk';
import { z } from 'zod';

export type ComposantsView = ComposantData<typeof PageComposants>;

/** A zod schema, read through its definition (zod 4). */
type Schema = z.core.$ZodType;

/**
 * The type of a field as a Moddeur reads it, derived from its schema: a named
 * schema (`.meta({ title })`) by its name, `string`, `number`, `boolean`, a
 * string format (`uuid`), an enum's values, `X[]`, `{ a, b }`, `X | undefined`
 * for an optional field, `X | null`.
 */
export const typeOf = (schema: Schema): string => {
  const title = z.globalRegistry.get(schema)?.title;
  if (title) return title;
  const def = schema._zod.def as z.core.$ZodTypeDef & Record<string, unknown>;
  switch (def.type) {
    case 'string':
      return typeof def['format'] === 'string' ? def['format'] : 'string';
    case 'enum':
      return Object.values(def['entries'] as Record<string, string | number>)
        .map((value) => JSON.stringify(value).replaceAll('"', "'"))
        .join(' | ');
    case 'literal':
      return (def['values'] as unknown[]).map((value) => JSON.stringify(value).replaceAll('"', "'")).join(' | ');
    case 'array':
      return `${wrap(def['element'] as Schema)}[]`;
    case 'object':
      return `{ ${Object.keys(def['shape'] as object).join(', ')} }`;
    case 'record':
      return `Record<${typeOf(def['keyType'] as Schema)}, ${typeOf(def['valueType'] as Schema)}>`;
    case 'union':
      return (def['options'] as Schema[]).map(typeOf).join(' | ');
    case 'optional':
      return `${typeOf(def['innerType'] as Schema)} | undefined`;
    case 'nullable':
      return `${typeOf(def['innerType'] as Schema)} | null`;
    case 'default':
    case 'readonly':
      return typeOf(def['innerType'] as Schema);
    default:
      return def.type;
  }
};

/** An array's element in parentheses when it is a union. */
const wrap = (schema: Schema): string => {
  const type = typeOf(schema);
  return type.includes(' | ') ? `(${type})` : type;
};

/** A catalogue's text, or `fallback` while a key is missing (the keys' test of the SDK fails then). */
const say = (key: string, fallback = ''): string => (Object.hasOwn(fr, key) ? t(key as MessageKey) : fallback);

const byName = (a: AnyComposant, b: AnyComposant) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * The data of the library's page (`/parametres/composants?c=<Name>`, US-23),
 * from the declarations: the Composants by category, sorted by name, then the
 * one `name` opens, the first of the catalogue when it is absent or unknown.
 */
export const composantsView = (
  declarations: Readonly<Record<string, AnyComposant>>,
  name: string | null,
): ComposantsView => {
  const all = Object.values(declarations);
  const groups = COMPOSANT_CATEGORIES.map((category) => ({
    category,
    composants: all
      .filter((declaration) => declaration.category === category)
      .sort(byName)
      .map(({ name, version }) => ({ name, version })),
  })).filter((group) => group.composants.length > 0);

  const first = groups[0]?.composants[0]?.name;
  const chosen = name !== null && Object.hasOwn(declarations, name) ? name : first;
  const declaration = chosen === undefined ? undefined : declarations[chosen];
  if (!declaration) throw new Error('Aucun Composant à documenter');

  const keys = composantKeys(declaration);
  const shape = declaration.data.shape as Record<string, Schema>;
  return {
    groups,
    selected: {
      name: declaration.name,
      version: declaration.version,
      tag: declaration.tag,
      category: declaration.category,
      description: say(keys.description, declaration.description),
      fields: Object.entries(shape).map(([field, schema]) => ({
        name: field,
        type: typeOf(schema),
        description: say(keys.data[field] ?? ''),
      })),
      // Every action is free until CORE-7 declares the Actions sensibles.
      actions: Object.keys(declaration.actions).map((action) => ({
        name: action,
        sensitive: false,
        description: say(keys.actions[action] ?? ''),
      })),
      slots: declaration.slots.map((slot) => ({ name: slot, description: say(keys.slots[slot] ?? '') })),
      examples: declaration.examples.map((example) => ({
        name: example.name,
        data: example.data as Record<string, unknown>,
        ...(example.slots ? { slots: example.slots as Record<string, string> } : {}),
      })),
    },
  };
};
