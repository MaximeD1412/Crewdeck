import { COMPOSANTS, PageComposants, PageConnexion, PageDemarrage, PageProjets, PageRunner, RepositoryPicker } from '@crewdeck/sdk';
import type { Route } from './router.js';
import { composantsView } from './views/composants.js';
import { connexionView } from './views/connexion.js';

/** The library of Composants' URL for one of them. */
export const composantsHref = (name: string): string => `/parametres/composants?c=${encodeURIComponent(name)}`;

/**
 * The page URLs of ADR 0008 and their page Composant, filled by the page
 * tickets: `/a-toi` → `PageAToi`, `/idees` and `/idees/:id`, `/conceptions`,
 * `/boucle`, `/planning`, `/statistiques`, `/projets`, `/parametres`,
 * `/parametres/composants`; `/connexion` → `PageConnexion`, the only page
 * open signed out; `/demarrage` → `PageDemarrage`, whose data `app.ts` gives
 * from « Premiers pas »' state (`getting-started.ts`); `/runner` →
 * `PageRunner`, whose data `app.ts` gives from the store
 * (`views/runner.ts`); `/projets` → `PageProjets` and `/projets/ajouter` →
 * `RepositoryPicker`, whose data `app.ts` gives from the store
 * (`views/projets.ts`, `projects.ts`). The first route that matches wins.
 */
export const ROUTES: readonly Route[] = [
  { path: '/connexion', composant: PageConnexion, data: (match) => connexionView(match.query) },
  { path: '/demarrage', composant: PageDemarrage },
  { path: '/runner', composant: PageRunner },
  { path: '/projets', composant: PageProjets },
  { path: '/projets/ajouter', composant: RepositoryPicker },
  {
    path: '/parametres/composants',
    composant: PageComposants,
    data: (match) => composantsView(COMPOSANTS, match.query['c'] ?? null),
  },
];
