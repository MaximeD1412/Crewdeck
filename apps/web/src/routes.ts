import { COMPOSANTS, PageAToi, PageComposants, PageConnexion, PageDemarrage, PageRunner, UsageCard } from '@crewdeck/sdk';
import type { Route, SlotContent } from './router.js';
import type { StoreState } from './store/store.js';
import { aToiView } from './views/a-toi.js';
import { composantsView } from './views/composants.js';
import { connexionView } from './views/connexion.js';
import { usageCard, usageCardCompact, type UsageCardData, type UsageState } from './views/usage.js';

/** The library of Composants' URL for one of them. */
export const composantsHref = (name: string): string => `/parametres/composants?c=${encodeURIComponent(name)}`;

/** « À toi », every Projet's Décisions, or one Projet's (`?projet=`). */
export const aToiHref = (projectId: string | null): string => (projectId ? `/a-toi?projet=${encodeURIComponent(projectId)}` : '/a-toi');

const usageOf = (state: StoreState): UsageState => ({ usage: state.slices.usage?.values() ?? [], runner: state.slices.runner ?? null });
const usageSlot = (data: UsageCardData | null): SlotContent | null => (data ? { composant: UsageCard, data } : null);

/**
 * The page URLs of ADR 0008 and their page Composant, filled by the page
 * tickets: `/a-toi` → `PageAToi`, `/idees` and `/idees/:id`, `/conceptions`,
 * `/boucle`, `/planning`, `/statistiques`, `/projets`, `/parametres`,
 * `/parametres/composants`; `/connexion` → `PageConnexion`, the only page
 * open signed out; `/demarrage` → `PageDemarrage`, whose data `app.ts` gives
 * from « Premiers pas »' state (`getting-started.ts`); `/runner` →
 * `PageRunner`, whose data `app.ts` gives from the store
 * (`views/runner.ts`). The usage of the Comptes IA fills `/runner`'s
 * Emplacement `usage` and « À toi »'s `ai-accounts` (`views/usage.ts`). The
 * first route that matches wins.
 */
export const ROUTES: readonly Route[] = [
  {
    path: '/a-toi',
    composant: PageAToi,
    data: (match, state) =>
      aToiView(state.slices.decision?.values() ?? [], match.query, { runnerOnline: state.slices.runner?.state === 'online' }),
    slots: (_match, state) => ({ 'ai-accounts': usageSlot(usageCardCompact(usageOf(state))) }),
  },
  { path: '/connexion', composant: PageConnexion, data: (match) => connexionView(match.query) },
  { path: '/demarrage', composant: PageDemarrage },
  { path: '/runner', composant: PageRunner, slots: (_match, state) => ({ usage: usageSlot(usageCard(usageOf(state))) }) },
  {
    path: '/parametres/composants',
    composant: PageComposants,
    data: (match) => composantsView(COMPOSANTS, match.query['c'] ?? null),
  },
];
