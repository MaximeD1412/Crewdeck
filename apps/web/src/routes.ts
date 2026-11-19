import {
  type IdeesTab,
  COMPOSANTS,
  PageAjouterProjet,
  PageAToi,
  PageComposants,
  PageConnexion,
  PageConnexionLien,
  PageDemarrage,
  PageIdees,
  PageParametres,
  PageProjet,
  PageProjets,
  PageRunner,
  UsageCard,
} from '@crewdeck/sdk';
import { currentDeviceId } from './api/request.js';
import type { PlacedNode } from './placed.js';
import type { Route } from './router.js';
import type { StoreState } from './store/store.js';
import { aToiView } from './views/a-toi.js';
import { composantsView } from './views/composants.js';
import { connexionView } from './views/connexion.js';
import { parametresView, timeZones } from './views/parametres.js';
import { usageCard, usageCardCompact, type UsageCardData, type UsageState } from './views/usage.js';

/** The library of Composants' URL for one of them. */
export const composantsHref = (name: string): string => `/parametres/composants?c=${encodeURIComponent(name)}`;

/** « À toi », every Projet's Décisions, or one Projet's (`?projet=`). */
export const aToiHref = (projectId: string | null): string => (projectId ? `/a-toi?projet=${encodeURIComponent(projectId)}` : '/a-toi');

/** A Projet's page. */
export const projetHref = (projectId: string): string => `/projets/${encodeURIComponent(projectId)}`;

/** « Ajouter un Projet », or the choice of a Local Projet's folder again (`?projet=`). */
export const ajouterHref = (projectId: string | null = null): string =>
  projectId ? `/projets/ajouter?projet=${encodeURIComponent(projectId)}` : '/projets/ajouter';

/** « Idées », every Projet's or one Projet's (`?projet=`), on a tab (`?onglet=`, « À trier » by default). */
export const ideesHref = (projectId: string | null, tab: IdeesTab): string => {
  const query = new URLSearchParams();
  if (projectId) query.set('projet', projectId);
  if (tab !== 'a-trier') query.set('onglet', tab);
  const search = query.toString();
  return search ? `/idees?${search}` : '/idees';
};

const usageOf = (state: StoreState): UsageState => ({ usage: state.slices.usage?.values() ?? [], runner: state.slices.runner ?? null });
/** The usage card in the Emplacement `slot`, or nothing when there is no usage to show. */
const usageSlot = (slot: string, data: UsageCardData | null): readonly PlacedNode[] => (data ? [{ tag: UsageCard.tag, slot, data }] : []);

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
 * (`views/runner.ts`); `/projets` → `PageProjets`, `/projets/ajouter` →
 * `PageAjouterProjet` (its folder's form and its RepositoryPicker;
 * `?projet=<id>` to choose a Local Projet's folder again) and `/projets/:id`
 * → `PageProjet`, whose data `app.ts` gives from the store and the page's own
 * state (`views/projets.ts`, `projects.ts`, `projects/`); `/parametres` → `PageParametres`,
 * whose « Rôles et modèles » `app.ts` completes with the page's own state
 * (`role-settings.ts`). The usage of the Comptes IA fills `/runner`'s
 * Emplacement `usage` and « À toi »'s `ai-accounts` (`views/usage.ts`). The first route that matches wins.
 */
export const ROUTES: readonly Route[] = [
  {
    path: '/a-toi',
    composant: PageAToi,
    data: (match, state) =>
      aToiView(state.slices.decision?.values() ?? [], match.query, { runnerOnline: state.slices.runner?.state === 'online' }),
    slots: (_match, state) => usageSlot('ai-accounts', usageCardCompact(usageOf(state))),
  },
  { path: '/idees', composant: PageIdees },
  { path: '/connexion', composant: PageConnexion, data: (match) => connexionView(match.query) },
  { path: '/connexion/lien', composant: PageConnexionLien },
  { path: '/demarrage', composant: PageDemarrage },
  { path: '/runner', composant: PageRunner, slots: (_match, state) => usageSlot('usage', usageCard(usageOf(state))) },
  { path: '/projets', composant: PageProjets },
  { path: '/projets/ajouter', composant: PageAjouterProjet },
  { path: '/projets/:id', composant: PageProjet },
  {
    path: '/parametres',
    composant: PageParametres,
    slots: (_match, state) => {
      const { slices } = state;
      return parametresView(slices.settings, timeZones(), {
        accounts: [...(slices['ai-account']?.values() ?? [])],
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
