import type { Me } from '@crewdeck/contracts';
import { Cadre, PageComposants, PageConnexion, type Skin } from '@crewdeck/sdk';
import passerelle from '@crewdeck/skin-passerelle';
import { dispatcher as pageDispatcher, type Dispatcher } from './actions/dispatcher.js';
import { me as readMe } from './api/auth.js';
import { createInPageBridge, type InPageBridge } from './bridge/in-page.js';
import { bootSkin } from './registry.js';
import { startRouter, type Route, type Router } from './router.js';
import { composantsHref, ROUTES } from './routes.js';
import { mountShell } from './shell.js';
import { signInGuard, signInHref } from './sign-in.js';

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
}

export interface App {
  readonly router: Router;
  readonly bridge: InPageBridge;
  readonly dispatcher: Dispatcher;
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
}: BootOptions): Promise<App> => {
  const [pilot] = await Promise.all([me().catch(() => null), bootSkin(skin, resolveSkin)]);
  dispatcher.listen(document);
  const bridge = createInPageBridge({ dispatch: dispatcher.dispatch });
  const shell = mountShell({ root, state: () => ({ slices: { pilot } }) });
  const router = startRouter({ routes, outlet: shell.outlet, onRoute: shell.update, guard: signInGuard(pilot) });
  dispatcher.registerAction(PageConnexion, 'signIn', {
    run: () => leave(signInHref(router.current.query['next'], Intl.DateTimeFormat().resolvedOptions().timeZone)),
  });
  dispatcher.registerAction(PageComposants, 'select', { run: ({ name }) => router.navigate(composantsHref(name)) });
  dispatcher.registerAction(Cadre, 'openPilot', { run: () => router.navigate('/parametres') });
  return { router, bridge, dispatcher };
};
