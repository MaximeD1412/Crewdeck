import { CD_ACTION, PageConnexion, PageConnexionLien } from '@crewdeck/sdk';
import { createDispatcher } from './actions/dispatcher.js';
import { ApiError } from './api/request.js';
import { boot } from './app.js';

type WithData = HTMLElement & { data: unknown };

const TOKEN = 'Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE';
const INVALID = new ApiError({ status: 422, code: 'auth.link-invalid', message: 'Ce lien de connexion n’est plus valable : demande-en un nouveau.' });

const action = (page: Element, name: string) =>
  page.dispatchEvent(
    new CustomEvent(CD_ACTION, { bubbles: true, composed: true, detail: { composant: 'PageConnexionLien', action: name, payload: {} } }),
  );

describe('a sign-in link opened signed out', () => {
  const verifyLink = vi.fn<(token: string, timeZone: string) => Promise<{ next: string }>>().mockRejectedValue(INVALID);
  const leave = vi.fn<(url: string) => void>();
  let app: Awaited<ReturnType<typeof boot>>;
  let cadre: WithData;
  const page = () => cadre.querySelector(PageConnexionLien.tag) as WithData;

  beforeAll(async () => {
    history.replaceState(null, '', `/connexion/lien#${TOKEN}`);
    const root = document.createElement('div');
    document.body.append(root);
    app = await boot({ root, dispatcher: createDispatcher(), me: async () => null, leave, verifyLink });
    cadre = root.firstElementChild as WithData;
  });

  afterAll(() => {
    app.stop();
    document.body.replaceChildren();
  });

  it('opens in the bare Cadre, the token out of the address bar, nothing posted before « Se connecter »', () => {
    expect(location.href).toBe(`${location.origin}/connexion/lien`);
    expect(cadre.data).toMatchObject({ variant: 'bare', pilot: null });
    expect(page().data).toEqual({ state: 'ready' });
    expect(verifyLink).not.toHaveBeenCalled();
  });

  it('« Se connecter » posts the token with the browser’s time zone; refused, the page offers a new link', async () => {
    action(page(), 'confirm');
    expect(verifyLink).toHaveBeenCalledWith(TOKEN, Intl.DateTimeFormat().resolvedOptions().timeZone);
    await vi.waitFor(() => expect(page().data).toEqual({ state: 'invalid' }));
    expect(leave).not.toHaveBeenCalled();
  });

  it('« Recevoir un nouveau lien » goes back to /connexion', async () => {
    action(page(), 'restart');
    await vi.waitFor(() => expect(location.pathname).toBe('/connexion'));
    expect(cadre.querySelector(PageConnexion.tag)).not.toBeNull();
  });
});
