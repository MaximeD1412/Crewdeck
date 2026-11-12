import { z } from 'zod';
import type { ActionDeclaration, ActionSchemaOf } from './sensitive.js';

/**
 * The library page's groups (US-23): « Cadre et menu », « Pages », « Parties
 * de page », « Signaux et contrôles ».
 */
export const COMPOSANT_CATEGORIES = ['cadre', 'page', 'partie', 'signal'] as const;
export type ComposantCategory = (typeof COMPOSANT_CATEGORIES)[number];

/** A fixture of a Composant: the library's preview and its tests render it. */
export interface ComposantExample<Data extends z.ZodObject, Slot extends string> {
  readonly name: string;
  readonly data: z.input<Data>;
  /** HTML put in each named Emplacement. */
  readonly slots?: Readonly<Partial<Record<Slot, string>>>;
}

export interface ComposantSpec<
  Name extends string,
  Data extends z.ZodObject,
  Actions extends Record<string, ActionDeclaration>,
  Slot extends string,
> {
  /** PascalCase, the key of the Composant in a Skin. */
  readonly name: Name;
  /** The contract's version; US-43 adds compatibility ranges on it. */
  readonly version: number;
  /** `cd-<kebab>`: the canonical tag the core defines the Skin's implementation under. */
  readonly tag: `cd-${string}`;
  readonly category: ComposantCategory;
  readonly description: string;
  /** What the element receives in its `data` property. */
  readonly data: Data;
  /**
   * The payload schema of each action the element emits as a `cd-action`, or
   * `sensitive(id, schema)` for an Action sensible.
   */
  readonly actions: Actions;
  /** The names of its Emplacements, native `<slot>`s of its shadow root. */
  readonly slots: readonly Slot[];
  /** At least one; each must be valid against `data`. */
  readonly examples: readonly ComposantExample<Data, Slot>[];
}

/** A Composant's contract (ADR 0006): data in, `cd-action` out, Emplacements as slots. */
export type ComposantDeclaration<
  Name extends string = string,
  Data extends z.ZodObject = z.ZodObject,
  Actions extends Record<string, ActionDeclaration> = Record<string, ActionDeclaration>,
  Slot extends string = string,
> = ComposantSpec<Name, Data, Actions, Slot>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any declaration, whatever its schemas
export type AnyComposant = ComposantDeclaration<string, any, any, string>;

/** What a Composant's `data` property holds. */
export type ComposantData<C extends AnyComposant> = z.output<C['data']>;
/** The names of a Composant's actions. */
export type ComposantAction<C extends AnyComposant> = Extract<keyof C['actions'], string>;
/** The payload a Composant emits with one of its actions. */
export type ComposantPayload<C extends AnyComposant, A extends ComposantAction<C>> = z.input<ActionSchemaOf<C['actions'][A]>>;
/** The payload the core's handler receives, once validated. */
export type ComposantParsedPayload<C extends AnyComposant, A extends ComposantAction<C>> = z.output<ActionSchemaOf<C['actions'][A]>>;

const PASCAL_CASE = /^[A-Z][a-zA-Z0-9]*$/;
const CD_TAG = /^cd-[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const check = (condition: boolean, name: string, message: string): void => {
  if (!condition) throw new Error(`Composant ${name} : ${message}`);
};

/**
 * Declares a Composant. Checks its shape and that each example is valid
 * against `data`, then returns it frozen. The schemas themselves are left as
 * zod builds them.
 */
export const defineComposant = <
  const Name extends string,
  Data extends z.ZodObject,
  Actions extends Record<string, ActionDeclaration>,
  const Slot extends string = never,
>(
  spec: ComposantSpec<Name, Data, Actions, Slot>,
): ComposantDeclaration<Name, Data, Actions, Slot> => {
  const { name } = spec;
  check(PASCAL_CASE.test(name), name, 'le nom doit être en PascalCase');
  check(CD_TAG.test(spec.tag), name, `la balise ${spec.tag} doit être de la forme cd-<kebab>`);
  check((COMPOSANT_CATEGORIES as readonly string[]).includes(spec.category), name, `catégorie ${spec.category} inconnue`);
  check(Number.isInteger(spec.version) && spec.version >= 1, name, 'la version doit être un entier positif');
  check(spec.examples.length > 0, name, 'il faut au moins un exemple');

  for (const example of spec.examples) {
    const result = spec.data.safeParse(example.data);
    check(result.success, name, `l'exemple « ${example.name} » ne respecte pas data : ${result.error?.message ?? ''}`);
    for (const slot of Object.keys(example.slots ?? {})) {
      check((spec.slots as readonly string[]).includes(slot), name, `l'exemple « ${example.name} » remplit l'Emplacement inconnu ${slot}`);
    }
  }

  return Object.freeze({
    ...spec,
    actions: Object.freeze({ ...spec.actions }),
    slots: Object.freeze([...spec.slots]),
    examples: Object.freeze(
      spec.examples.map((example) =>
        Object.freeze({ ...example, ...(example.slots && { slots: Object.freeze({ ...example.slots }) }) }),
      ),
    ) as unknown as ComposantSpec<Name, Data, Actions, Slot>['examples'],
  });
};
