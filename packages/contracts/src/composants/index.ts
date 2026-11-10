import type { AnyComposant } from './define.js';
import { PageIntrouvable } from './page-introuvable.js';

export * from './action.js';
export * from './define.js';
export * from './page-introuvable.js';

/**
 * Every Composant's declaration, by name: a Skin (with its parents) implements
 * each of them. The UI and page tickets add theirs.
 */
export const COMPOSANTS = { PageIntrouvable } as const satisfies Record<string, AnyComposant>;

export type ComposantName = keyof typeof COMPOSANTS;
