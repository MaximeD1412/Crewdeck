import { type IdeesTab, COMPOSANTS, PageAToi, PageComposants, PageConnexion, PageConnexionLien, PageDemarrage, PageIdees, PageParametres, PageProjets, PageRunner, RepositoryPicker } from '@crewdeck/sdk';
import { currentDeviceId } from './api/request.js';
import type { Route } from './router.js';
import { aToiView } from './views/a-toi.js';
import { composantsView } from './views/composants.js';
import { connexionView } from './views/connexion.js';
import { parametresView, timeZones } from './views/parametres.js';

/** The library of Composants' URL for one of them. */
export const composantsHref = (name: string): string => `/parametres/composants?c=${encodeURIComponent(name)}`;

/** « À toi », every Projet's Décisions, or one Projet's (`?projet=`). */
export const aToiHref = (projectId: string | null): string => (projectId ? `/a-toi?projet=${encodeURIComponent(projectId)}` : '/a-toi');

/** « Idées », every Projet's or one Projet's (`?projet=`), on a tab (`?onglet=`, « À trier » by default). */
export const ideesHref = (projectId: string | null, tab: IdeesTab): string => {
  const query = new URLSearchParams();
  if (projectId) query.set('projet', projectId);
  if (tab !== 'a-trier') query.set('onglet', tab);
  const search = query.toString();
  return search ? `/idees?${search}` : '/idees';
};

/**
 * The page URLs of ADR 0008 and their page Composant, filled by the page
 * tickets: `/a-toi` → `PageAToi`, `/idees` and `/idees/:id`, `/conceptions`,
 * `/boucle`, `/planning`, `/statistiques`, `/projets`, `/parametres`,
 * `/parametres/composants`; `/connexion` → `PageConnexion` and
 * `/connexion/lien` → `PageConnexionLien`, the only pages open signed out,
 * whose form and link `app.ts` keeps (`views/connexion.ts`,
 * `views/connexion-lien.ts`); `/demarrage` → `PageDemarrage`, whose data `app.ts` gives
 * from « Premiers pas »' state (`getting-started.ts`); `/idees` → `PageIdees`,
 * whose data `app.ts` gives from the store and the texts in clear
 * (`views/idees.ts`); `/runner` →
 * `PageRunner`, whose data `app.ts` gives from the store
 * (`views/runner.ts`); `/projets` → `PageProjets` and `/projets/ajouter` →
 * `RepositoryPicker`, whose data `app.ts` gives from the store
 * (`views/projets.ts`, `projects.ts`); `/parametres` → `PageParametres`,
 * whose « Rôles et modèles » `app.ts` completes with the page's own state
 * (`role-settings.ts`). The first route that matches wins.
 */
export const ROUTES: readonly Route[] = [
  {
    path: '/a-toi',
    composant: PageAToi,
    data: (match, state) =>
      aToiView(state.slices.decision?.values() ?? [], match.query, { runnerOnline: state.slices.runner?.state === 'online' }),
  },
  { path: '/idees', composant: PageIdees },
  { path: '/connexion', composant: PageConnexion, data: (match) => connexionView(match.query) },
  { path: '/connexion/lien', composant: PageConnexionLien },
  { path: '/demarrage', composant: PageDemarrage },
  { path: '/runner', composant: PageRunner },
  { path: '/projets', composant: PageProjets },
  { path: '/projets/ajouter', composant: RepositoryPicker },
  {
    path: '/parametres',
    composant: PageParametres,
    slots: (match, state) => {
      const { slices } = state;
      return parametresView(slices.settings, timeZones(), {
        accounts: [...(slices['ai-account']?.values() ?? [])],
        pilot: slices.pilot,
        erreur: match.query['erreur'],
        devices: slices.device,
        currentDeviceId: currentDeviceId(),
      });
    },
  },
  {
    path: '/parametres/composants',
    composant: PageComposants,
    data: (match) => composantsView(COMPOSANTS, match.query['c'] ?? null),
  },
];
