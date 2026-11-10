import { PageComposants, type Skin } from '@crewdeck/sdk';
import passerelle from '@crewdeck/skin-passerelle';
import { dispatcher as pageDispatcher, type Dispatcher } from './actions/dispatcher.js';
import { createInPageBridge, type InPageBridge } from './bridge/in-page.js';
import { bootSkin } from './registry.js';
import { startRouter, type Route, type Router } from './router.js';
import { composantsHref, ROUTES } from './routes.js';

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
}

export interface App {
  readonly router: Router;
  readonly bridge: InPageBridge;
  readonly dispatcher: Dispatcher;
}

/**
 * The page's boot, once the tokens' CSS is loaded (`main.ts`): the Skin and
 * its parents defined under the `cd-*` tags, the `cd-action` dispatcher on the
 * document, then the router rendering the current page into `root`, and the
 * actions that only move between pages.
 */
export const boot = async ({ root, skin = passerelle, routes = ROUTES, dispatcher = pageDispatcher }: BootOptions): Promise<App> => {
  await bootSkin(skin, resolveSkin);
  dispatcher.listen(document);
  const bridge = createInPageBridge({ dispatch: dispatcher.dispatch });
  const router = startRouter({ routes, outlet: root });
  dispatcher.registerAction(PageComposants, 'select', { run: ({ name }) => router.navigate(composantsHref(name)) });
  return { router, bridge, dispatcher };
};
