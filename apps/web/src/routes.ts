import { COMPOSANTS, PageAToi, PageComposants, PageConnexion, PageDemarrage, PageParametres, PageParametresProjet, PageProjets, PageRunner, RepositoryPicker } from '@crewdeck/sdk';
import type { Route } from './router.js';
import type { StoreState } from './store/store.js';
import { aToiView } from './views/a-toi.js';
import { composantsView } from './views/composants.js';
import { connexionView } from './views/connexion.js';
import { parametresView, timeZones } from './views/parametres.js';
import { parametresProjetView } from './views/parametres-projet.js';

/** The library of Composants' URL for one of them. */
export const composantsHref = (name: string): string => `/parametres/composants?c=${encodeURIComponent(name)}`;

/** « À toi », every Projet's Décisions, or one Projet's (`?projet=`). */
export const aToiHref = (projectId: string | null): string => (projectId ? `/a-toi?projet=${encodeURIComponent(projectId)}` : '/a-toi');

/** A Projet's Paramètres from the store alone, its worktree Commandes locked: `null` until the store has the Projet and the settings. */
const projetView = (id: string | undefined, state: StoreState) => {
  const project = state.slices.project?.get(id ?? '');
  if (!project || !state.slices.settings) return null;
  return parametresProjetView({ project, settings: state.slices.settings, accounts: [...(state.slices['ai-account']?.values() ?? [])] });
};

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
 * (`views/projets.ts`, `projects.ts`); `/parametres` → `PageParametres`,
 * whose « Rôles et modèles » `app.ts` completes with the page's own state
 * (`role-settings.ts`); `/projets/:id/parametres` → `PageParametresProjet`,
 * which `app.ts` completes with the page's own state (`project-settings.ts`).
 * The first route that matches wins.
 */
export const ROUTES: readonly Route[] = [
  {
    path: '/a-toi',
    composant: PageAToi,
    data: (match, state) =>
      aToiView(state.slices.decision?.values() ?? [], match.query, { runnerOnline: state.slices.runner?.state === 'online' }),
  },
  { path: '/connexion', composant: PageConnexion, data: (match) => connexionView(match.query) },
  { path: '/demarrage', composant: PageDemarrage },
  { path: '/runner', composant: PageRunner },
  { path: '/projets', composant: PageProjets },
  { path: '/projets/ajouter', composant: RepositoryPicker },
  {
    path: '/projets/:id/parametres',
    composant: PageParametresProjet,
    data: (match, state) => projetView(match.params['id'], state)?.data ?? { project: '', changedCount: 0, counts: {} },
    slots: (match, state) => projetView(match.params['id'], state)?.slots ?? [],
  },
  {
    path: '/parametres',
    composant: PageParametres,
    slots: (_match, state) =>
      parametresView(state.slices.settings, timeZones(), {
        accounts: [...(state.slices['ai-account']?.values() ?? [])],
        projects: [...(state.slices.project?.values() ?? [])],
      }),
  },
  {
    path: '/parametres/composants',
    composant: PageComposants,
    data: (match) => composantsView(COMPOSANTS, match.query['c'] ?? null),
  },
];
