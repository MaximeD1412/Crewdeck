import type { AnyComposant } from '@crewdeck/contracts/composants';

/** The keys of a Composant's documentation in the catalogue, for the library's page (US-23). */
export interface ComposantKeys {
  readonly description: string;
  /** One per field of its `data`. */
  readonly data: Readonly<Record<string, string>>;
  readonly slots: Readonly<Record<string, string>>;
  readonly actions: Readonly<Record<string, string>>;
}

const keyed = (names: readonly string[], prefix: string): Record<string, string> =>
  Object.fromEntries(names.map((name) => [name, `${prefix}.${name}`]));

/**
 * `composants.<Name>.description`, `composants.<Name>.data.<field>`,
 * `composants.<Name>.slots.<slot>`, `composants.<Name>.actions.<action>`.
 */
export const composantKeys = (declaration: AnyComposant): ComposantKeys => {
  const root = `composants.${declaration.name}`;
  return {
    description: `${root}.description`,
    data: keyed(Object.keys(declaration.data.shape), `${root}.data`),
    slots: keyed(declaration.slots, `${root}.slots`),
    actions: keyed(Object.keys(declaration.actions), `${root}.actions`),
  };
};

/** The keys of `declaration` that `catalogue` lacks, in the order of `composantKeys`. */
export const missingComposantKeys = (declaration: AnyComposant, catalogue: Readonly<Record<string, string>>): string[] => {
  const keys = composantKeys(declaration);
  return [keys.description, ...Object.values(keys.data), ...Object.values(keys.slots), ...Object.values(keys.actions)].filter(
    (key) => !Object.hasOwn(catalogue, key),
  );
};
