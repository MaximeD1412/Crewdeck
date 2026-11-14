import type { Decision } from '@crewdeck/contracts';
import { Banner, Button, Cadre, CodeBlock, MenuItem } from '@crewdeck/sdk';
import { announcer as pageAnnouncer, type Announcer } from './announcer.js';
import type { RouteMatch } from './router.js';
import { bannersView, type BannerAction, type BannerView } from './views/banners.js';
import { cadreView, type CadreState } from './views/cadre.js';

type WithData = HTMLElement & { data: unknown };

export interface Shell {
  /** Where the router renders the page: a child of the Cadre, its page Emplacement, laid out as its own children. */
  readonly outlet: HTMLElement;
  /** The Cadre, its menu and its Banners for the page just rendered (the router's `onRoute`): a navigation takes the error away. */
  readonly update: (match: RouteMatch) => void;
  /** The same for a new state of the store, on the same page. */
  readonly refresh: () => void;
  /** An API error no caller handled: its `message` in a halt Banner, until the next navigation. */
  readonly showError: (message: string) => void;
}

/** What the Cadre and its Banners read of the store. */
export interface ShellState extends CadreState {
  /** When the page lost the state (the store's `lostAt`). */
  readonly lostAt?: Date | null;
  readonly slices: Omit<CadreState['slices'], 'decision'> & {
    /** The open Décisions: « Runner hors ligne »'s Banner reads its own (ATOI-3). */
    readonly decision?: ReadonlyMap<string, Decision>;
  };
}

export interface ShellOptions {
  readonly root: HTMLElement;
  /** What the Cadre reads of the store; nothing without a store (signed out). */
  readonly state?: () => ShellState;
  /** The aria-live region the core speaks through (the dispatcher's refusals); the page's by default. */
  readonly announcer?: Announcer;
  /** Moves to a page of the app: a Banner's button (« Voir le Runner »). The router's, once it is started. */
  readonly navigate?: (url: string) => void;
}

/** A Banner on the page: its element, the text node of its default Emplacement, the element of its `actions` one. */
interface MountedBanner {
  readonly element: WithData;
  readonly text: Text;
  action: { readonly kind: BannerAction['kind']; readonly element: WithData } | null;
  /** Where its button leads, read on each click. */
  href: string | null;
}

const EMPTY: ShellState = { slices: {} };

/**
 * Mounts the Cadre (US-23) into `root`: a `cd-cadre` holding the router's
 * outlet, its `menu` Emplacement filled with one `cd-menu-item` per entry,
 * the same elements from page to page, and its `banner` Emplacement with the
 * core's Banners (the Resynchronisation, an unhandled API error). After the
 * outlet, the page's aria-live region, which no navigation replaces.
 */
export const mountShell = ({ root, state = () => EMPTY, announcer = pageAnnouncer, navigate = (url) => location.assign(url) }: ShellOptions): Shell => {
  const cadre = document.createElement(Cadre.tag) as WithData;
  const outlet = document.createElement('div');
  outlet.style.display = 'contents';
  cadre.append(outlet, announcer.element);
  root.replaceChildren(cadre);
  const items: WithData[] = [];
  const banners = new Map<BannerView['key'], MountedBanner>();
  let route: RouteMatch | null = null;
  let error: string | null = null;

  const mountBanner = (): MountedBanner => {
    const element = document.createElement(Banner.tag) as WithData;
    element.slot = 'banner';
    const text = document.createTextNode('');
    element.append(text);
    return { element, text, action: null, href: null };
  };

  /** The Banner's action: a `cd-button` whose click moves to its page, or a `cd-code-block`; the same element while its kind stays. */
  const renderAction = (banner: MountedBanner, action: BannerAction | undefined) => {
    if (banner.action && banner.action.kind !== action?.kind) {
      banner.action.element.remove();
      banner.action = null;
    }
    banner.href = action?.kind === 'button' ? action.href : null;
    if (!action) return;
    if (!banner.action) {
      const element = document.createElement(action.kind === 'button' ? Button.tag : CodeBlock.tag) as WithData;
      element.slot = 'actions';
      if (action.kind === 'button') {
        element.addEventListener('click', () => {
          if (banner.href !== null) navigate(banner.href);
        });
      }
      banner.element.append(element);
      banner.action = { kind: action.kind, element };
    }
    banner.action.element.data = action.data;
  };

  const renderBanners = (current: ShellState) => {
    const views = bannersView(
      {
        connection: current.connection ?? 'live',
        lostAt: current.lostAt ?? null,
        path: route?.path ?? null,
        runner: current.slices.runner ?? null,
        decisions: current.slices.decision?.values() ?? [],
      },
      error,
    );
    const kept = new Set(views.map((view) => view.key));
    for (const [key, banner] of banners) {
      if (kept.has(key)) continue;
      banner.element.remove();
      banners.delete(key);
    }
    // From the last: a new Banner goes before the one that follows it, the Emplacement keeping the views' order.
    let next: HTMLElement = outlet;
    for (const view of [...views].reverse()) {
      let banner = banners.get(view.key);
      if (!banner) {
        banner = mountBanner();
        banners.set(view.key, banner);
        cadre.insertBefore(banner.element, next);
      }
      banner.element.data = view.data;
      banner.text.data = view.text ?? '';
      renderAction(banner, view.action);
      next = banner.element;
    }
  };

  const render = () => {
    if (!route) return;
    const current = state();
    const view = cadreView(current, route);
    view.menu.forEach((data, index) => {
      let item = items[index];
      if (!item) {
        item = document.createElement(MenuItem.tag) as WithData;
        item.slot = 'menu';
        items.push(item);
        cadre.insertBefore(item, outlet);
      }
      item.data = data;
    });
    renderBanners(current);
    cadre.data = view.cadre;
  };

  return {
    outlet,
    update(match) {
      route = match;
      error = null;
      render();
    },
    refresh: render,
    showError(message) {
      error = message;
      render();
    },
  };
};
