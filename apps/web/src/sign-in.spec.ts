import type { Me } from '@crewdeck/contracts';
import { CD_ACTION, PageConnexion, PageConnexionLien, PageIntrouvable, t } from '@crewdeck/sdk';
import { createDispatcher } from './actions/dispatcher.js';
import { boot } from './app.js';
import { matchRoute, NO_STATE } from './router.js';
import { ROUTES } from './routes.js';
import { githubSignInHref, signInGuard } from './sign-in.js';

type WithData = HTMLElement & { data: unknown; updateComplete: Promise<unknown> };

const ME: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', displayName: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done', identities: [] };

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

  it('lets /connexion and /connexion/lien be, signed out', () => {
    expect(guarded(null, '/connexion?erreur=denied')).toBeNull();
    expect(guarded(null, '/connexion/lien')).toBeNull();
  });

  it('sends a Pilote signed in from /connexion and /connexion/lien to « À toi », and lets every other page be', () => {
    expect(guarded(ME, '/connexion?next=%2Fidees')).toBe('/a-toi');
    expect(guarded(ME, '/connexion/lien')).toBe('/a-toi');
    expect(guarded(ME, '/idees')).toBeNull();
    expect(guarded(ME, '/nope')).toBeNull();
  });
});

describe('githubSignInHref', () => {
  it('starts the GitHub sign-in with the time zone and the page to come back to, « À toi » by default', () => {
    const query = (href: string) => {
      const url = new URL(href, 'http://crewdeck.invalid');
      expect(url.pathname).toBe('/api/auth/github/start');
      return Object.fromEntries(url.searchParams);
    };
    expect(query(githubSignInHref('/idees?session=s1', 'Europe/Paris'))).toEqual({ timeZone: 'Europe/Paris', next: '/idees?session=s1' });
    expect(query(githubSignInHref(undefined, 'America/Montreal'))).toEqual({ timeZone: 'America/Montreal', next: '/a-toi' });
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
    expect(ROUTES.find((route) => route.composant === PageConnexion)?.data?.(match, NO_STATE)).toEqual({ error, sentTo: null, emailError: null, busy: false });
  });

  it('gives no error without ?erreur', () => {
    const match = matchRoute(ROUTES, '/connexion');
    expect(ROUTES.find((route) => route.composant === PageConnexion)?.data?.(match, NO_STATE)).toEqual({ error: null, sentTo: null, emailError: null, busy: false });
    expect(matchRoute(ROUTES, '/connexion/x').composant).toBe(PageIntrouvable);
  });

  it('opens /connexion/lien on PageConnexionLien', () => {
    expect(matchRoute(ROUTES, '/connexion/lien').composant).toBe(PageConnexionLien);
  });
});

const action = (page: Element, composant: string, name: string, payload: unknown) =>
  page.dispatchEvent(new CustomEvent(CD_ACTION, { bubbles: true, composed: true, detail: { composant, action: name, payload } }));

describe('the page signed out', () => {
  const leave = vi.fn<(url: string) => void>();
  const requestLink = vi.fn<(email: string, next: string) => Promise<void>>().mockResolvedValue();
  let app: Awaited<ReturnType<typeof boot>>;
  let cadre: WithData;
  const page = () => cadre.querySelector(PageConnexion.tag) as WithData;

  beforeAll(async () => {
    history.replaceState(null, '', '/idees?session=s1');
    const root = document.createElement('div');
    document.body.append(root);
    app = await boot({ root, dispatcher: createDispatcher(), me: () => Promise.reject(new Error('réseau')), leave, requestLink });
    cadre = root.firstElementChild as WithData;
  });

  afterAll(() => {
    app.router.stop();
    document.body.replaceChildren();
  });

  it('opens /connexion in the bare Cadre, with the page to come back to', async () => {
    expect(location.pathname + location.search).toBe('/connexion?next=%2Fidees%3Fsession%3Ds1');
    expect(cadre.data).toMatchObject({ variant: 'bare', pilot: null });
    expect(page().data).toEqual({ error: null, sentTo: null, emailError: null, busy: false });
    await page().updateComplete;
    expect(page().shadowRoot?.querySelector('h1')?.textContent).toBe(t('connexion.title'));
  });

  it('signInWith leaves for GitHub with the browser’s time zone and the page to come back to', async () => {
    action(page(), 'PageConnexion', 'signInWith', { provider: 'github' });
    await vi.waitFor(() => expect(leave).toHaveBeenCalledOnce());
    expect(leave).toHaveBeenCalledWith(githubSignInHref('/idees?session=s1', Intl.DateTimeFormat().resolvedOptions().timeZone));
  });

  it('requestLink asks for a link coming back to the page, then shows where it went; changeEmail brings the field back', async () => {
    action(page(), 'PageConnexion', 'requestLink', { email: 'pilote@example.com' });
    expect(requestLink).toHaveBeenCalledWith('pilote@example.com', '/idees?session=s1');
    await vi.waitFor(() => expect(page().data).toMatchObject({ sentTo: 'pilote@example.com', busy: false }));
    action(page(), 'PageConnexion', 'changeEmail', {});
    await vi.waitFor(() => expect(page().data).toMatchObject({ sentTo: null }));
  });
});
