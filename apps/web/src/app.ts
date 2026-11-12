import type { Me } from '@crewdeck/contracts';
import { Cadre, PageComposants, PageConnexion, PageDemarrage, PageProjets, PageRunner, RepositoryPicker, type Skin } from '@crewdeck/sdk';
import passerelle from '@crewdeck/skin-passerelle';
import { dispatcher as pageDispatcher, type Dispatcher } from './actions/dispatcher.js';
import { me as readMe } from './api/auth.js';
import type { Client } from './api/client.js';
import { ApiError } from './api/request.js';
import { createInPageBridge, type InPageBridge } from './bridge/in-page.js';
import { createGettingStarted, gettingStartedGuard } from './getting-started.js';
import { createPageKeys, type PageKeys } from './keys/index.js';
import { createProjects } from './projects.js';
import { bootSkin } from './registry.js';
import { routeData, startRouter, type Route, type Router } from './router.js';
import { composantsHref, ROUTES } from './routes.js';
import { mountShell } from './shell.js';
import { signInGuard, signInHref } from './sign-in.js';
import { client as pageClient, connection as pageConnection, store as pageStore } from './store/index.js';
import type { Connection } from './store/connection.js';
import { createLatencyMeter, type LatencyMeter } from './store/latency.js';
import type { Store } from './store/store.js';
import { systemOfBrowser } from './views/demarrage.js';
import { projetsView } from './views/projets.js';
import { runnerView } from './views/runner.js';

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
  readonly client?: Pick<Client, 'command' | 'query'>;
  /** The latency the page measures on its store's live events (CORE-8): started with the socket. */
  readonly latency?: LatencyMeter;
  /** This browser's Appareil and the vault (E2E-2): IndexedDB and WebCrypto by default. */
  readonly keys?: Pick<PageKeys, 'linkKeys' | 'nameDevice' | 'unlockVault'>;
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
  keys = createPageKeys({ store, client, userAgent: navigator.userAgent }),
}: BootOptions): Promise<App> => {
  const [pilot] = await Promise.all([me().catch(() => null), bootSkin(skin, resolveSkin)]);
  dispatcher.listen(document);
  const bridge = createInPageBridge({ dispatch: dispatcher.dispatch });
  // The Pilote of `/api/me` until the snapshot gives the store's.
  const shell = mountShell({
    root,
    state: () => {
      const state = store.getState();
      return { ...state, slices: { ...state.slices, pilot: state.slices.pilot !== undefined ? state.slices.pilot : pilot } };
    },
  });
  const onUnhandled = (event: PromiseRejectionEvent) => {
    if (!(event.reason instanceof ApiError)) return;
    event.preventDefault();
    shell.showError(event.reason.message);
  };
  window.addEventListener('unhandledrejection', onUnhandled);
  const gettingStarted = createGettingStarted({
    store,
    client,
    bootPilot: pilot,
    origin: location.origin,
    system: systemOfBrowser(navigator.userAgent),
    keys: keys.linkKeys,
    unlockVault: () => keys.unlockVault(),
  });
  const projects = createProjects({ store, client });
  const signIn = signInGuard(pilot);
  const started = gettingStartedGuard(gettingStarted.pilot);
  const pageData = routeData(routes);
  const router = startRouter({
    routes,
    outlet: shell.outlet,
    onRoute: shell.update,
    guard: (match) => started(match) ?? signIn(match),
    data: (match) => {
      if (match.composant === PageDemarrage) return { ...gettingStarted.view(), picker: projects.picker('demarrage') };
      if (match.composant === RepositoryPicker) return projects.picker('projets');
      const { slices } = store.getState();
      if (match.composant === PageProjets) return projetsView(slices.project?.values() ?? []);
      if (match.composant !== PageRunner) return pageData(match);
      return runnerView({ runner: slices.runner ?? null, accounts: slices['ai-account']?.values() ?? [] });
    },
  });
  const unsubscribe = [
    store.subscribe(() => {
      gettingStarted.sync();
      router.refresh();
      shell.refresh();
    }),
    gettingStarted.subscribe(() => router.refresh()),
    projects.subscribe(() => router.refresh()),
  ];
  if (pilot) {
    // The Appareil named before the snapshot, which says which one is `current`.
    await keys.nameDevice();
    void keys.unlockVault();
    latency.start();
    connection.start();
  }
  dispatcher.registerAction(PageConnexion, 'signIn', {
    run: () => leave(signInHref(router.current.query['next'], Intl.DateTimeFormat().resolvedOptions().timeZone)),
  });
  dispatcher.registerAction(PageComposants, 'select', { run: ({ name }) => router.navigate(composantsHref(name)) });
  dispatcher.registerAction(Cadre, 'openPilot', { run: () => router.navigate('/parametres') });
  dispatcher.registerAction(PageDemarrage, 'selectSystem', { run: ({ system }) => gettingStarted.selectSystem(system) });
  dispatcher.registerAction(PageDemarrage, 'retry', { run: () => gettingStarted.retry() });
  dispatcher.registerAction(PageDemarrage, 'continue', { run: () => gettingStarted.advance() });
  dispatcher.registerAction(PageProjets, 'add', { run: () => router.navigate('/projets/ajouter') });
  // In « Premiers pas » the Projets followed end it; on `/projets/ajouter` the list shows them.
  dispatcher.registerAction(RepositoryPicker, 'follow', {
    run: async ({ repositoryIds }) => {
      await projects.follow(repositoryIds);
      if (router.current.composant === PageDemarrage) await gettingStarted.advance();
      else router.navigate('/projets');
    },
  });
  const stop = () => {
    router.stop();
    connection.stop();
    latency.stop();
    for (const stopListening of unsubscribe) stopListening();
    window.removeEventListener('unhandledrejection', onUnhandled);
  };
  return { router, bridge, dispatcher, stop };
};
