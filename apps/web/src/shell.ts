import { Cadre, MenuItem } from '@crewdeck/sdk';
import type { RouteMatch } from './router.js';
import { cadreView, type CadreState } from './views/cadre.js';

type WithData = HTMLElement & { data: unknown };

export interface Shell {
  /** Where the router renders the page: a child of the Cadre, its page Emplacement, laid out as its own children. */
  readonly outlet: HTMLElement;
  /** The Cadre and its menu for the page just rendered (the router's `onRoute`). */
  readonly update: (match: RouteMatch) => void;
}

export interface ShellOptions {
  readonly root: HTMLElement;
  /** What the Cadre reads of the store; none before CORE-6. */
  readonly state?: () => CadreState;
}

const EMPTY: CadreState = { slices: {} };

/**
 * Mounts the Cadre (US-23) into `root`: a `cd-cadre` holding the router's
 * outlet, and its `menu` Emplacement filled with one `cd-menu-item` per
 * entry, the same elements from page to page.
 */
export const mountShell = ({ root, state = () => EMPTY }: ShellOptions): Shell => {
  const cadre = document.createElement(Cadre.tag) as WithData;
  const outlet = document.createElement('div');
  outlet.style.display = 'contents';
  cadre.append(outlet);
  root.replaceChildren(cadre);
  const items: WithData[] = [];

  const update = (match: RouteMatch) => {
    const view = cadreView(state(), match);
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
    cadre.data = view.cadre;
  };

  return { outlet, update };
};
