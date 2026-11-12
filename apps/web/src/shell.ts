import { Banner, Cadre, MenuItem } from '@crewdeck/sdk';
import { announcer as pageAnnouncer, type Announcer } from './announcer.js';
import type { RouteMatch } from './router.js';
import { bannersView, type BannerView } from './views/banners.js';
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
}

export interface ShellOptions {
  readonly root: HTMLElement;
  /** What the Cadre reads of the store; nothing without a store (signed out). */
  readonly state?: () => ShellState;
  /** The aria-live region the core speaks through (the dispatcher's refusals); the page's by default. */
  readonly announcer?: Announcer;
}

const EMPTY: ShellState = { slices: {} };

/**
 * Mounts the Cadre (US-23) into `root`: a `cd-cadre` holding the router's
 * outlet, its `menu` Emplacement filled with one `cd-menu-item` per entry,
 * the same elements from page to page, and its `banner` Emplacement with the
 * core's Banners (the Resynchronisation, an unhandled API error). After the
 * outlet, the page's aria-live region, which no navigation replaces.
 */
export const mountShell = ({ root, state = () => EMPTY, announcer = pageAnnouncer }: ShellOptions): Shell => {
  const cadre = document.createElement(Cadre.tag) as WithData;
  const outlet = document.createElement('div');
  outlet.style.display = 'contents';
  cadre.append(outlet, announcer.element);
  root.replaceChildren(cadre);
  const items: WithData[] = [];
  const banners = new Map<BannerView['key'], WithData>();
  let route: RouteMatch | null = null;
  let error: string | null = null;

  const renderBanners = (current: ShellState) => {
    const views = bannersView({ connection: current.connection ?? 'live', lostAt: current.lostAt ?? null }, error);
    const kept = new Set(views.map((view) => view.key));
    for (const [key, element] of banners) {
      if (kept.has(key)) continue;
      element.remove();
      banners.delete(key);
    }
    // From the last: a new Banner goes before the one that follows it, the Emplacement keeping the views' order.
    let next: HTMLElement = outlet;
    for (const view of [...views].reverse()) {
      let element = banners.get(view.key);
      if (!element) {
        element = document.createElement(Banner.tag) as WithData;
        element.slot = 'banner';
        banners.set(view.key, element);
        cadre.insertBefore(element, next);
      }
      element.data = view.data;
      element.textContent = view.text;
      next = element;
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
