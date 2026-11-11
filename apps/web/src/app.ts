import type { Me } from '@crewdeck/contracts';
import { Cadre, PageComposants, PageConnexion, PageParametres, type Skin } from '@crewdeck/sdk';
import passerelle from '@crewdeck/skin-passerelle';
import { dispatcher as pageDispatcher, type Dispatcher } from './actions/dispatcher.js';
import { me as readMe } from './api/auth.js';
import type { Client } from './api/client.js';
import { ApiError } from './api/request.js';
import { updateSettings } from './api/settings.js';
import { createInPageBridge, type InPageBridge } from './bridge/in-page.js';
import { bootSkin } from './registry.js';
import { startRouter, type Route, type Router } from './router.js';
import { composantsHref, ROUTES } from './routes.js';
import { mountShell } from './shell.js';
import { signInGuard, signInHref } from './sign-in.js';
import { client as pageClient, connection as pageConnection, store as pageStore } from './store/index.js';
import type { Connection } from './store/connection.js';
import { createLatencyMeter, type LatencyMeter } from './store/latency.js';
import type { Store } from './store/store.js';

/** The Skins the page knows, by id: at the MVP, the default one. */
const SKINS: Readonly<Record<string, Skin>> = { passerelle };

const resolveSkin = (id: string): Skin => {
  const skin = Object.hasOwn(SKINS, id) ? SKINS[id] : undefined;
  if (!skin) throw new Error(`Skin ${id} inconnu`);
  return skin;
};

export interface BootOptions {
  readonly root: HTMLElement;
  readonly skin?: Skin;
  readonly routes?: readonly Route[];
  readonly dispatcher?: Dispatcher;
  /** The Pilote signed in, `null` without a session: `GET /api/me` by default. */
  readonly me?: () => Promise<Me | null>;
  /** Leaves the page for another document (the GitHub sign-in): `location.assign` by default. */
  readonly leave?: (url: string) => void;
  /** The page's store and its socket (`store/index.ts`) by default. */
  readonly store?: Store;
  readonly connection?: Pick<Connection, 'start' | 'stop'>;
  /** The page's commands (`store/index.ts`) by default. */
  readonly client?: Pick<Client, 'command'>;
  /** The latency the page measures on its store's live events (CORE-8): started with the socket. */
  readonly latency?: LatencyMeter;
}

export interface App {
  readonly router: Router;
  readonly bridge: InPageBridge;
  readonly dispatcher: Dispatcher;
  /** Stops the router, the socket and what listens (the tests). */
  readonly stop: () => void;
}

/**
 * The page's boot, once the tokens' CSS is loaded (`main.ts`): the Skin and
 * its parents defined under the `cd-*` tags, the `cd-action` dispatcher on the
 * document, the Pilote signed in (a Pilote it cannot read counts as signed
 * out), the Cadre in `root`, then the router rendering the current page into
 * the Cadre behind the sign-in's guard, and the actions that only move
 * between pages.
 */
export const boot = async ({
  root,
  skin = passerelle,
  routes = ROUTES,
  dispatcher = pageDispatcher,
  me = readMe,
  leave = (url) => location.assign(url),
  store = pageStore,
  connection = pageConnection,
  client = pageClient,
  latency = createLatencyMeter({ store }),
}: BootOptions): Promise<App> => {
  const [pilot] = await Promise.all([me().catch(() => null), bootSkin(skin, resolveSkin)]);
  dispatcher.listen(document);
  const bridge = createInPageBridge({ dispatch: dispatcher.dispatch });
  // The Pilote of `/api/me` until the snapshot gives the store's.
  const shell = mountShell({
    root,
    state: () => {
      const state = store.getState();
      return { ...state, slices: { pilot: state.slices.pilot !== undefined ? state.slices.pilot : pilot } };
    },
  });
  const onUnhandled = (event: PromiseRejectionEvent) => {
    if (!(event.reason instanceof ApiError)) return;
    event.preventDefault();
    shell.showError(event.reason.message);
  };
  window.addEventListener('unhandledrejection', onUnhandled);
  const router = startRouter({ routes, outlet: shell.outlet, state: store.getState, onRoute: shell.update, guard: signInGuard(pilot) });
  // The Cadre and the page follow the store: a change made elsewhere shows without a reload.
  const unsubscribe = store.subscribe(() => {
    shell.refresh();
    router.refresh();
  });
  if (pilot) {
    latency.start();
    connection.start();
  }
  dispatcher.registerAction(PageConnexion, 'signIn', {
    run: () => leave(signInHref(router.current.query['next'], Intl.DateTimeFormat().resolvedOptions().timeZone)),
  });
  dispatcher.registerAction(PageComposants, 'select', { run: ({ name }) => router.navigate(composantsHref(name)) });
  dispatcher.registerAction(PageParametres, 'change', {
    run: async ({ name, value }) => {
      if (name === 'timeZone' && typeof value === 'string') await updateSettings(client, { timeZone: value });
    },
  });
  dispatcher.registerAction(Cadre, 'openPilot', { run: () => router.navigate('/parametres') });
  const stop = () => {
    router.stop();
    connection.stop();
    latency.stop();
    unsubscribe();
    window.removeEventListener('unhandledrejection', onUnhandled);
  };
  return { router, bridge, dispatcher, stop };
};
