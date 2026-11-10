import type { ComposantName } from '@crewdeck/contracts/composants';

/** Where a Skin is meant to be used: at 1280 px and wider, or below. */
export type SkinTarget = 'pc' | 'telephone';

export interface SkinSpec {
  readonly id: string;
  /** The Skin it extends: its Composants fill what this one does not implement. */
  readonly parent: string | null;
  readonly targets: readonly SkinTarget[];
  /** The implementation of each Composant, a custom element defined by the core under the canonical tag. */
  readonly composants: Readonly<Partial<Record<ComposantName, CustomElementConstructor>>>;
}

export type Skin = SkinSpec;

/** The one breakpoint of the product (`design/DESIGN.md`). */
export const BREAKPOINT_PX = 1280;

/**
 * Declares a Skin (ADR 0006). The core merges it with its parents at boot and
 * defines each implementation; a Skin never calls `customElements.define`.
 */
export const defineSkin = (spec: SkinSpec): Skin => {
  if (spec.targets.length === 0) throw new Error(`Skin ${spec.id} : il faut au moins une cible`);
  return Object.freeze({
    ...spec,
    targets: Object.freeze([...spec.targets]),
    composants: Object.freeze({ ...spec.composants }),
  });
};
