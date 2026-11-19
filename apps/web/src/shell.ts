import type { Decision, Device } from '@crewdeck/contracts';
import { Banner, Button, Cadre, CodeBlock, MenuItem } from '@crewdeck/sdk';
import { announcer as pageAnnouncer, type Announcer } from './announcer.js';
import type { VaultState } from './keys/vault.js';
import type { RouteMatch } from './router.js';
import type { StoreState } from './store/store.js';
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
  /** Adds an element of the core the pages share (« Noter une Idée »'s Dialog) to the Cadre, after the page, laid out as its own children. */
  readonly append: (element: HTMLElement) => void;
  /** The panel over the page (the Session panel) in the Cadre's `panel` Emplacement, in place of the one before; `null` closes it. */
  readonly setPanel: (element: HTMLElement | null) => void;
}

/** What the Cadre and its Banners read of the store. */
export interface ShellState extends CadreState {
  /** When the page lost the state (the store's `lostAt`). */
  readonly lostAt?: Date | null;
  /** Where this browser stands with the vault key: `no-device` offers to approve it. */
  readonly vaultState?: VaultState;
  readonly slices: Omit<CadreState['slices'], 'decision'> & {
    /** The open Décisions: « Runner hors ligne »'s Banner reads its own (ATOI-3). */
    readonly decision?: ReadonlyMap<string, Decision>;
    readonly device?: ReadonlyMap<string, Device>;
    /** The vault's version: above 0, another Appareil or the Runner holds it (E2E-4). */
    readonly vault?: StoreState['slices']['vault'];
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
  /** A Banner's button with no page to lead to was clicked: « Approuver cet Appareil » (`device`). */
  readonly onBannerAction?: (key: BannerView['key']) => void;
}

/** A Banner on the page: its element, the text node of its default Emplacement, the element of its `actions` one. */
interface MountedBanner {
  readonly key: BannerView['key'];
  readonly element: WithData;
  readonly text: Text;
  action: { readonly kind: BannerAction['kind']; readonly element: WithData } | null;
  /** Where its button leads, read on each click; `null` for one the Shell reports. */
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
export const mountShell = ({
  root,
  state = () => EMPTY,
  announcer = pageAnnouncer,
  navigate = (url) => location.assign(url),
  onBannerAction,
}: ShellOptions): Shell => {
  const cadre = document.createElement(Cadre.tag) as WithData;
  const outlet = document.createElement('div');
  outlet.style.display = 'contents';
  cadre.append(outlet, announcer.element);
  root.replaceChildren(cadre);
  const items: WithData[] = [];
  const banners = new Map<BannerView['key'], MountedBanner>();
  let route: RouteMatch | null = null;
  let error: string | null = null;
  let panel: HTMLElement | null = null;

  const mountBanner = (key: BannerView['key']): MountedBanner => {
    const element = document.createElement(Banner.tag) as WithData;
    element.slot = 'banner';
    const text = document.createTextNode('');
    element.append(text);
    return { key, element, text, action: null, href: null };
  };

  /**
   * The Banner's action: a `cd-button` whose click moves to its page, or is
   * reported (`onBannerAction`) when it has none, or a `cd-code-block`; the
   * same element while its kind stays.
   */
  const renderAction = (banner: MountedBanner, action: BannerAction | undefined) => {
    if (banner.action && banner.action.kind !== action?.kind) {
      banner.action.element.remove();
      banner.action = null;
    }
    banner.href = action?.kind === 'button' ? (action.href ?? null) : null;
    if (!action) return;
    if (!banner.action) {
      const element = document.createElement(action.kind === 'button' ? Button.tag : CodeBlock.tag) as WithData;
      element.slot = 'actions';
      if (action.kind === 'button') {
        element.addEventListener('click', () => {
          if (banner.href !== null) navigate(banner.href);
          else onBannerAction?.(banner.key);
        });
      }
      banner.element.append(element);
      banner.action = { kind: action.kind, element };
    }
    banner.action.element.data = action.data;
  };

  const renderBanners = (current: ShellState, bare: boolean) => {
    const all = bannersView(
      {
        connection: current.connection ?? 'live',
        lostAt: current.lostAt ?? null,
        path: route?.path ?? null,
        session: route?.panel.session != null,
        runner: current.slices.runner ?? null,
        decisions: current.slices.decision?.values() ?? [],
        ...(current.vaultState ? { vaultState: current.vaultState } : {}),
        slices: { ...(current.slices.device ? { device: current.slices.device } : {}), ...(current.slices.vault ? { vault: current.slices.vault } : {}) },
      },
      error,
    );
    // A bare page (the sign-in, « Premiers pas ») has no room for an offer.
    const views = bare ? all.filter((view) => view.key !== 'device') : all;
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
        banner = mountBanner(view.key);
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
    renderBanners(current, view.cadre.variant === 'bare');
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
    append(element) {
      element.style.display = 'contents';
      cadre.insertBefore(element, announcer.element);
    },
    setPanel(element) {
      if (panel && panel !== element) panel.remove();
      panel = element;
      if (!element) return;
      element.slot = 'panel';
      if (element.parentElement !== cadre) cadre.insertBefore(element, announcer.element);
    },
  };
};
