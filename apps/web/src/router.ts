import { PageIntrouvable, type AnyComposant } from '@crewdeck/sdk';
import type { StoreState } from './store/store.js';

/**
 * A page URL (French, ADR 0008), `:name` for a parameter, its page Composant
 * and the view giving its `data`, from the match and the store's state.
 */
export interface Route {
  readonly path: string;
  readonly composant: AnyComposant;
  readonly data?: (match: RouteMatch, state: StoreState) => unknown;
}

export interface RouteMatch {
  /** The normalised path, without its query. */
  readonly path: string;
  readonly composant: AnyComposant;
  readonly params: Readonly<Record<string, string>>;
  /** The query's parameters, the last one of a repeated name. */
  readonly query: Readonly<Record<string, string>>;
  /** The panel open over the page: `?session=<id>` shows an AgentSession. */
  readonly panel: { readonly session: string | null };
}

/** The URLs that only lead elsewhere: « À toi » is the home. */
export const REDIRECTS: Readonly<Record<string, string>> = { '/': '/a-toi' };

const segments = (path: string): string[] => path.split('/').filter(Boolean);

const normalise = (pathname: string): string => (pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname) || '/';

const matchPath = (pattern: string, path: string): Record<string, string> | null => {
  const expected = segments(pattern);
  const actual = segments(path);
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (const [i, part] of expected.entries()) {
    const value = actual[i] as string;
    if (part.startsWith(':')) {
      try {
        params[part.slice(1)] = decodeURIComponent(value);
      } catch {
        return null;
      }
    } else if (part !== value) return null;
  }
  return params;
};

/**
 * The page Composant of `url` and its parameters: the first route of the table
 * that matches, else `PageIntrouvable`.
 */
export const matchRoute = (routes: readonly Route[], url: string | URL): RouteMatch => {
  const parsed = new URL(url, 'http://crewdeck.invalid');
  const path = normalise(parsed.pathname);
  const query = Object.fromEntries(parsed.searchParams);
  const panel = { session: parsed.searchParams.get('session') };
  for (const route of routes) {
    const params = matchPath(route.path, path);
    if (params) return { path, composant: route.composant, params, query, panel };
  }
  return { path, composant: PageIntrouvable, params: {}, query, panel };
};

/** The state of a router without a store: nothing received yet. */
export const NO_STATE: StoreState = { seq: null, connection: 'connecting', lostAt: null, slices: {} };

/** The page's `data` by default: its route's view, else nothing. */
const routeData =
  (routes: readonly Route[], state: () => StoreState) =>
  (match: RouteMatch): unknown =>
    routes.find((route) => route.composant === match.composant && matchPath(route.path, match.path))?.data?.(match, state()) ?? {};

export interface Router {
  readonly current: RouteMatch;
  /** Goes to a page URL of the app (path, query, hash) through the History API. */
  navigate(url: string, options?: { replace?: boolean }): void;
  /** Gives the page shown its `data` again, for a new state of the store: same URL, same element. */
  refresh(): void;
  stop(): void;
}

export interface RouterOptions {
  readonly routes: readonly Route[];
  /** Where the page Composant is rendered. */
  readonly outlet: HTMLElement;
  /** The `data` of the page. By default, its route's `data`, from the match and `state`. */
  readonly data?: (match: RouteMatch) => unknown;
  /** The store's state the routes' views read: nothing received by default. */
  readonly state?: () => StoreState;
  /** Called after each render, with the match. */
  readonly onRoute?: (match: RouteMatch) => void;
  readonly redirects?: Readonly<Record<string, string>>;
  /**
   * Before each render, the URL to show in place of the one matched, or
   * `null` to show it: the sign-in's guard (`app.ts`). Its URL is not guarded again.
   */
  readonly guard?: (match: RouteMatch) => string | null;
}

/** A click the app handles: the main button, no modifier, a same-origin page URL in this tab. */
const linkOf = (event: MouseEvent): URL | null => {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.composedPath().find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
  if (!anchor || !anchor.hasAttribute('href') || anchor.hasAttribute('download')) return null;
  if (anchor.target && anchor.target !== '_self') return null;
  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/')) return null;
  return url;
};

/**
 * Starts the page's router: renders the page Composant of the current URL into
 * `outlet`, then follows `navigate()`, the same-origin links (shadow roots
 * included) and the browser's back and forward.
 */
export const startRouter = ({
  routes,
  state = () => NO_STATE,
  outlet,
  data = routeData(routes, state),
  onRoute,
  redirects = REDIRECTS,
  guard,
}: RouterOptions): Router => {
  let current: RouteMatch;

  const render = () => {
    const path = normalise(location.pathname);
    const target = Object.hasOwn(redirects, path) ? redirects[path] : undefined;
    if (target) history.replaceState(history.state, '', target + location.search + location.hash);
    current = matchRoute(routes, location.href);
    const elsewhere = guard?.(current);
    if (elsewhere) {
      history.replaceState(null, '', elsewhere);
      current = matchRoute(routes, location.href);
    }
    const existing = outlet.firstElementChild;
    const page =
      existing && existing.localName === current.composant.tag && outlet.childElementCount === 1
        ? existing
        : document.createElement(current.composant.tag);
    (page as Element & { data: unknown }).data = data(current);
    if (page !== existing || outlet.childElementCount !== 1) outlet.replaceChildren(page);
    onRoute?.(current);
  };

  const navigate = (url: string, { replace = false }: { replace?: boolean } = {}) => {
    const next = new URL(url, location.href);
    const href = next.pathname + next.search + next.hash;
    if (href === location.pathname + location.search + location.hash) return;
    if (replace) history.replaceState(null, '', href);
    else history.pushState(null, '', href);
    render();
  };

  const onClick = (event: MouseEvent) => {
    const url = linkOf(event);
    if (!url) return;
    event.preventDefault();
    navigate(url.href);
  };

  document.addEventListener('click', onClick);
  window.addEventListener('popstate', render);
  render();

  return {
    get current() {
      return current;
    },
    navigate,
    refresh() {
      const page = outlet.firstElementChild;
      if (page && page.localName === current.composant.tag) (page as Element & { data: unknown }).data = data(current);
    },
    stop() {
      document.removeEventListener('click', onClick);
      window.removeEventListener('popstate', render);
    },
  };
};
