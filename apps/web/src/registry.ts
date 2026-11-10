import { COMPOSANTS, type AnyComposant, type Skin } from '@crewdeck/sdk';

/** Finds a Skin by its id: the parent a Skin names. */
export type ResolveParent = (id: string) => Skin | Promise<Skin>;

export interface BootOptions {
  /** The declarations the Skin must implement; every Composant by default. */
  readonly declarations?: Readonly<Record<string, AnyComposant>>;
  readonly registry?: CustomElementRegistry;
}

/** The Skin and its parents, the Skin first. */
const lineage = async (skin: Skin, resolveParent: ResolveParent): Promise<Skin[]> => {
  const chain = [skin];
  for (let current = skin; current.parent !== null; ) {
    const parentId: string = current.parent;
    if (chain.some((s) => s.id === parentId)) {
      throw new Error(`Skin ${skin.id} : cycle de parents (${[...chain.map((s) => s.id), parentId].join(' → ')})`);
    }
    current = await resolveParent(parentId);
    chain.push(current);
  }
  return chain;
};

/**
 * Boots the page's one Skin (ADR 0006): merges it with its parents (a child's
 * Composant wins), checks every declaration has an implementation, then
 * defines each under its canonical `cd-*` tag. Nothing is defined when the
 * check fails. Changing Skin reloads the page.
 */
export const bootSkin = async (
  skin: Skin,
  resolveParent: ResolveParent,
  { declarations = COMPOSANTS, registry = customElements }: BootOptions = {},
): Promise<Readonly<Record<string, CustomElementConstructor>>> => {
  const chain = await lineage(skin, resolveParent);
  const merged: Record<string, CustomElementConstructor> = {};
  for (const ancestor of [...chain].reverse()) Object.assign(merged, ancestor.composants);

  const unknown = Object.keys(merged).filter((name) => !Object.hasOwn(declarations, name));
  if (unknown.length > 0) throw new Error(`Skin ${skin.id} : Composants inconnus : ${unknown.join(', ')}`);
  const missing = Object.keys(declarations).filter((name) => !merged[name]);
  if (missing.length > 0) throw new Error(`Skin ${skin.id} : Composants sans implémentation : ${missing.join(', ')}`);

  const taken = Object.values(declarations).filter((declaration) => registry.get(declaration.tag));
  if (taken.length > 0) {
    throw new Error(`Skin ${skin.id} : ${taken.map((d) => d.tag).join(', ')} déjà défini, un seul Skin par page`);
  }

  for (const [name, declaration] of Object.entries(declarations)) {
    registry.define(declaration.tag, merged[name] as CustomElementConstructor);
  }
  return Object.freeze(merged);
};
