import { COMPOSANTS, PageComposants } from '@crewdeck/sdk';
import type { Route } from './router.js';
import { composantsView } from './views/composants.js';

/** The library of Composants' URL for one of them. */
export const composantsHref = (name: string): string => `/parametres/composants?c=${encodeURIComponent(name)}`;

/**
 * The page URLs of ADR 0008 and their page Composant, filled by the page
 * tickets: `/a-toi` → `PageAToi`, `/idees` and `/idees/:id`, `/conceptions`,
 * `/boucle`, `/planning`, `/statistiques`, `/projets`, `/runner`,
 * `/parametres`, `/parametres/composants`. The first route that matches wins.
 */
export const ROUTES: readonly Route[] = [
  {
    path: '/parametres/composants',
    composant: PageComposants,
    data: (match) => composantsView(COMPOSANTS, match.query['c'] ?? null),
  },
];
