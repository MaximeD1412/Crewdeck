import type { Route } from './router.js';

/**
 * The page URLs of ADR 0008 and their page Composant, filled by the page
 * tickets: `/a-toi` → `PageAToi`, `/idees` and `/idees/:id`, `/conceptions`,
 * `/boucle`, `/planning`, `/statistiques`, `/projets`, `/runner`,
 * `/parametres`, `/parametres/composants`. The first route that matches wins.
 */
export const ROUTES: readonly Route[] = [];
