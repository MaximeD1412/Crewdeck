import type { Me } from '@crewdeck/contracts';
import { CD_ACTION, PageConnexion, PageIntrouvable, t } from '@crewdeck/sdk';
import { createDispatcher } from './actions/dispatcher.js';
import { boot } from './app.js';
import { matchRoute } from './router.js';
import { ROUTES } from './routes.js';
import { signInGuard, signInHref } from './sign-in.js';

type WithData = HTMLElement & { data: unknown; updateComplete: Promise<unknown> };

const ME: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', login: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris' };

/** The guard's answer for the page at `url`, where the browser is. */
const guarded = (pilot: Me | null, url: string) => {
  history.replaceState(null, '', url);
  return signInGuard(pilot)(matchRoute(ROUTES, location.href));
};

describe('signInGuard', () => {
  it.each([
    ['/a-toi', '/connexion?next=%2Fa-toi'],
    ['/idees?session=s1', '/connexion?next=%2Fidees%3Fsession%3Ds1'],
    ['/nope#x', '/connexion?next=%2Fnope%23x'],
  ])('sends %s, signed out, to /connexion with the page to come back to', (url, target) => {
    expect(guarded(null, url)).toBe(target);
  });

  it('lets /connexion be, signed out', () => {
    expect(guarded(null, '/connexion?erreur=denied')).toBeNull();
  });

  it('sends a Pilote signed in from /connexion to « À toi », and lets every other page be', () => {
    expect(guarded(ME, '/connexion?next=%2Fidees')).toBe('/a-toi');
    expect(guarded(ME, '/idees')).toBeNull();
    expect(guarded(ME, '/nope')).toBeNull();
  });
});

describe('signInHref', () => {
  it('starts the GitHub sign-in with the time zone and the page to come back to, « À toi » by default', () => {
    const query = (href: string) => {
      const url = new URL(href, 'http://crewdeck.invalid');
      expect(url.pathname).toBe('/api/auth/github/start');
      return Object.fromEntries(url.searchParams);
    };
    expect(query(signInHref('/idees?session=s1', 'Europe/Paris'))).toEqual({ timeZone: 'Europe/Paris', next: '/idees?session=s1' });
    expect(query(signInHref(undefined, 'America/Montreal'))).toEqual({ timeZone: 'America/Montreal', next: '/a-toi' });
  });
});

describe('the /connexion route', () => {
  it.each([
    ['state-mismatch', 'state-mismatch'],
    ['denied', 'denied'],
    ['github-unavailable', 'github-unavailable'],
    ['autre', null],
  ])('gives PageConnexion the error of ?erreur=%s', (erreur, error) => {
    const match = matchRoute(ROUTES, `/connexion?erreur=${erreur}`);
    expect(match.composant).toBe(PageConnexion);
    expect(ROUTES.find((route) => route.composant === PageConnexion)?.data?.(match)).toEqual({ error });
  });

  it('gives no error without ?erreur', () => {
    const match = matchRoute(ROUTES, '/connexion');
    expect(ROUTES.find((route) => route.composant === PageConnexion)?.data?.(match)).toEqual({ error: null });
    expect(matchRoute(ROUTES, '/connexion/x').composant).toBe(PageIntrouvable);
  });
});

describe('the page signed out', () => {
  afterEach(() => document.body.replaceChildren());

  it('opens /connexion in the bare Cadre, whose signIn leaves for GitHub with the browser’s time zone and the page to come back to', async () => {
    history.replaceState(null, '', '/idees?session=s1');
    const root = document.createElement('div');
    document.body.append(root);
    const leave = vi.fn<(url: string) => void>();
    const app = await boot({ root, dispatcher: createDispatcher(), me: () => Promise.reject(new Error('réseau')), leave });

    expect(location.pathname + location.search).toBe('/connexion?next=%2Fidees%3Fsession%3Ds1');
    const cadre = root.firstElementChild as WithData;
    expect(cadre.data).toMatchObject({ variant: 'bare', pilot: null });
    const page = cadre.querySelector(PageConnexion.tag) as WithData;
    expect(page.data).toEqual({ error: null });
    await page.updateComplete;
    expect(page.shadowRoot?.querySelector('h1')?.textContent).toBe(t('connexion.title'));

    page.dispatchEvent(
      new CustomEvent(CD_ACTION, { bubbles: true, composed: true, detail: { composant: 'PageConnexion', action: 'signIn', payload: {} } }),
    );
    await vi.waitFor(() => expect(leave).toHaveBeenCalledOnce());
    expect(leave).toHaveBeenCalledWith(signInHref('/idees?session=s1', Intl.DateTimeFormat().resolvedOptions().timeZone));
    app.router.stop();
  });
});
