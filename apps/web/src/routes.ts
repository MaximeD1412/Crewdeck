import {
  type IdeesTab,
  COMPOSANTS,
  PageAToi,
  PageComposants,
  PageConnexion,
  PageConnexionLien,
  PageDemarrage,
  PageIdees,
  PageParametres,
  PageParametresProjet,
  PageProcessEditor,
  PageProjets,
  PageRunner,
  RepositoryPicker,
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
import { parametresProjetView } from './views/parametres-projet.js';
import { usageCard, usageCardCompact, type UsageCardData, type UsageState } from './views/usage.js';

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
 * (`views/runner.ts`); `/projets` → `PageProjets` and `/projets/ajouter` →
 * `RepositoryPicker`, whose data `app.ts` gives from the store
 * (`views/projets.ts`, `projects.ts`); `/projets/:id/process` →
 * `PageProcessEditor`, whose data `app.ts` gives from the store and the
 * page's own state (`views/process-editor.ts`, `process/editor-ui.ts`);
 * `/parametres` → `PageParametres`,
 * whose « Rôles et modèles » `app.ts` completes with the page's own state
 * (`role-settings.ts`); `/projets/:id/parametres` → `PageParametresProjet`,
 * which `app.ts` completes with the page's own state (`project-settings.ts`).
 * The usage of the Comptes IA fills `/runner`'s Emplacement `usage` and
 * « À toi »'s `ai-accounts` (`views/usage.ts`). The first route that matches wins.
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
  { path: '/projets/ajouter', composant: RepositoryPicker },
  { path: '/projets/:id/process', composant: PageProcessEditor },
  {
    path: '/projets/:id/parametres',
    composant: PageParametresProjet,
    data: (match, state) => projetView(match.params['id'], state)?.data ?? { project: '', changedCount: 0, counts: {} },
    slots: (match, state) => projetView(match.params['id'], state)?.slots ?? [],
  },
  {
    path: '/parametres',
    composant: PageParametres,
    slots: (match, state) => {
      const { slices } = state;
      return parametresView(slices.settings, timeZones(), {
        accounts: [...(slices['ai-account']?.values() ?? [])],
        pilot: slices.pilot,
        erreur: match.query['erreur'],
        projects: [...(slices.project?.values() ?? [])],
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
