import { defineComposant, PageIntrouvable } from '@crewdeck/sdk';
import { z } from 'zod';
import { matchRoute, startRouter, type Route, type Router } from './router.js';
import type { StoreState } from './store/store.js';

const page = (name: string, tag: `cd-${string}`) =>
  defineComposant({
    name,
    version: 1,
    tag,
    category: 'page',
    description: name,
    data: z.object({}),
    actions: {},
    slots: [],
    examples: [{ name: 'nominal', data: {} }],
  });

const PageAToi = page('PageAToi', 'cd-page-a-toi');
const PageIdees = page('PageIdees', 'cd-page-idees');
const PageIdee = page('PageIdee', 'cd-page-idee');
const PageComposants = page('PageComposants', 'cd-page-composants');

const routes: Route[] = [
  { path: '/a-toi', composant: PageAToi },
  { path: '/idees', composant: PageIdees },
  { path: '/idees/:id', composant: PageIdee },
  { path: '/parametres/composants', composant: PageComposants, data: (match) => ({ c: match.query['c'] ?? null }) },
];

const ID = '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b';

describe('matchRoute', () => {
  it('maps a URL with a parameter to its page Composant with the parameter', () => {
    expect(matchRoute(routes, `/idees/${ID}`)).toEqual({
      path: `/idees/${ID}`,
      composant: PageIdee,
      params: { id: ID },
      query: {},
      panel: { session: null },
    });
  });

  it('gives the query', () => {
    expect(matchRoute(routes, '/parametres/composants?c=Banner&x=a%20b').query).toEqual({ c: 'Banner', x: 'a b' });
  });

  it('keeps ?session= as a panel parameter', () => {
    expect(matchRoute(routes, `/idees/${ID}?session=abc`)).toMatchObject({
      composant: PageIdee,
      params: { id: ID },
      panel: { session: 'abc' },
    });
  });

  it('maps a static URL, with or without its trailing slash', () => {
    expect(matchRoute(routes, '/parametres/composants').composant).toBe(PageComposants);
    expect(matchRoute(routes, '/idees/').composant).toBe(PageIdees);
  });

  it('decodes a parameter', () => {
    expect(matchRoute(routes, '/idees/a%20b').params).toEqual({ id: 'a b' });
  });

  it.each(['/nope', '/idees/x/y', '/a-toi-bis', '/'])('gives PageIntrouvable for %s', (path) => {
    expect(matchRoute(routes, path)).toMatchObject({ composant: PageIntrouvable, params: {} });
  });
});

describe('startRouter', () => {
  let router: Router;
  let outlet: HTMLElement;

  const start = (path: string) => {
    history.replaceState(null, '', path);
    outlet = document.createElement('main');
    document.body.append(outlet);
    router = startRouter({ routes, outlet });
  };

  afterEach(() => {
    router.stop();
    document.body.replaceChildren();
  });

  /** A link inside a Composant's shadow root, as the Skin draws them. */
  const link = (href: string, attributes: Record<string, string> = {}) => {
    const host = document.createElement('div');
    outlet.append(host);
    const a = document.createElement('a');
    a.href = href;
    for (const [name, value] of Object.entries(attributes)) a.setAttribute(name, value);
    host.attachShadow({ mode: 'open' }).append(a);
    return a;
  };

  /** Clicks `el` and says whether the router took the click; the browser never follows the link. */
  const click = (el: Element, init: MouseEventInit = {}) => {
    let defaultPrevented = false;
    const guard = (event: Event) => {
      defaultPrevented = event.defaultPrevented;
      event.preventDefault();
    };
    window.addEventListener('click', guard, { once: true });
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, button: 0, ...init }));
    return { defaultPrevented };
  };

  it('renders the page Composant of the current URL', () => {
    start(`/idees/${ID}`);
    expect(outlet.firstElementChild?.localName).toBe('cd-page-idee');
    expect(router.current).toMatchObject({ composant: PageIdee, params: { id: ID } });
  });

  it('renders PageIntrouvable for an unknown URL', () => {
    start('/nope');
    expect(outlet.firstElementChild?.localName).toBe('cd-page-introuvable');
    expect((outlet.firstElementChild as HTMLElement & { data: unknown }).data).toEqual({});
  });

  it('gives the page its route’s data, from the match, and keeps the page when only the query changes', () => {
    start('/parametres/composants?c=Banner');
    const page = outlet.firstElementChild as HTMLElement & { data: unknown };
    expect(page.localName).toBe('cd-page-composants');
    expect(page.data).toEqual({ c: 'Banner' });
    router.navigate('/parametres/composants?c=Button');
    expect(outlet.firstElementChild).toBe(page);
    expect(page.data).toEqual({ c: 'Button' });
  });

  it('gives a route’s data the store’s state, and refresh() gives the same page its data again', () => {
    history.replaceState(null, '', '/a-toi');
    outlet = document.createElement('main');
    document.body.append(outlet);
    let state: StoreState = { seq: 1n, connection: 'live', lostAt: null, slices: { pilot: null } };
    const withState: Route[] = [{ path: '/a-toi', composant: PageAToi, data: (_match, current) => ({ seq: current.seq }) }];
    router = startRouter({ routes: withState, outlet, state: () => state });
    const page = outlet.firstElementChild as HTMLElement & { data: unknown };
    expect(page.data).toEqual({ seq: 1n });
    state = { ...state, seq: 2n };
    router.refresh();
    expect(outlet.firstElementChild).toBe(page);
    expect(page.data).toEqual({ seq: 2n });
  });

  it('sends / to « À toi »', () => {
    start('/');
    expect(location.pathname).toBe('/a-toi');
    expect(outlet.firstElementChild?.localName).toBe('cd-page-a-toi');
  });

  it('navigates with the History API', () => {
    start('/a-toi');
    router.navigate('/idees?session=s1');
    expect(location.pathname + location.search).toBe('/idees?session=s1');
    expect(outlet.firstElementChild?.localName).toBe('cd-page-idees');
    expect(router.current.panel).toEqual({ session: 's1' });
  });

  it('follows the back button', async () => {
    start('/a-toi');
    router.navigate('/idees');
    history.back();
    await vi.waitFor(() => expect(outlet.firstElementChild?.localName).toBe('cd-page-a-toi'));
  });

  it('intercepts a click on a same-origin link, even inside a shadow root', () => {
    start('/a-toi');
    const event = click(link(`/idees/${ID}`));
    expect(event.defaultPrevented).toBe(true);
    expect(location.pathname).toBe(`/idees/${ID}`);
    expect(outlet.firstElementChild?.localName).toBe('cd-page-idee');
  });

  it.each([
    ['another origin', 'https://github.com/x', {}, {}],
    ['the API', '/api/auth/github', {}, {}],
    ['a new tab', '/idees', { target: '_blank' }, {}],
    ['a download', '/idees', { download: '' }, {}],
    ['a modified click', '/idees', {}, { metaKey: true }],
    ['a middle click', '/idees', {}, { button: 1 }],
  ])('leaves a link to the browser for %s', (_case, href, attributes, init) => {
    start('/a-toi');
    const event = click(link(href, attributes), init);
    expect(event.defaultPrevented).toBe(false);
    expect(location.pathname).toBe('/a-toi');
  });

  it('stops intercepting once stopped', () => {
    start('/a-toi');
    router.stop();
    const event = click(link('/idees'));
    expect(event.defaultPrevented).toBe(false);
  });

  it('sends the page its guard names elsewhere, in place of the URL, with its query', () => {
    history.replaceState(null, '', '/idees?x=1');
    outlet = document.createElement('main');
    document.body.append(outlet);
    const seen: string[] = [];
    router = startRouter({
      routes,
      outlet,
      guard: (match) => {
        seen.push(match.path);
        return match.path === '/a-toi' ? null : `/a-toi?from=${encodeURIComponent(match.path)}`;
      },
    });
    expect(location.pathname + location.search).toBe('/a-toi?from=%2Fidees');
    expect(outlet.firstElementChild?.localName).toBe('cd-page-a-toi');
    expect(router.current.query).toEqual({ from: '/idees' });

    router.navigate('/idees/x');
    expect(location.pathname).toBe('/a-toi');
    expect(seen).toEqual(['/idees', '/idees/x']);
  });
});
