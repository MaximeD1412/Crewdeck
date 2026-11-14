import { COMPOSANTS } from '@crewdeck/sdk';
import { ApiError } from '../api/request.js';
import { createConnexionLien, LINK_PATH, takeLinkToken } from './connexion-lien.js';

const TOKEN = 'Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE';
const INVALID = new ApiError({ status: 422, code: 'auth.link-invalid', message: 'Ce lien de connexion n’est plus valable : demande-en un nouveau.' });

const valid = (view: unknown) => COMPOSANTS.PageConnexionLien.data.parse(view);

const options = (overrides: Partial<Parameters<typeof createConnexionLien>[0]> = {}) => ({
  token: TOKEN,
  timeZone: 'Europe/Paris',
  verifyLink: vi.fn<(token: string, timeZone: string) => Promise<{ next: string }>>().mockResolvedValue({ next: '/demarrage' }),
  leave: vi.fn<(url: string) => void>(),
  navigate: vi.fn<(url: string) => void>(),
  ...overrides,
});

describe('takeLinkToken', () => {
  afterEach(() => history.replaceState(null, '', '/'));

  it('takes the token out of /connexion/lien’s fragment, the address bar left without it', () => {
    history.replaceState(null, '', `${LINK_PATH}#${TOKEN}`);
    expect(takeLinkToken()).toBe(TOKEN);
    expect(location.href).toBe(`${location.origin}${LINK_PATH}`);
    expect(location.hash).toBe('');
  });

  it('removes a fragment that is no token too, and gives none', () => {
    history.replaceState(null, '', `${LINK_PATH}#pas-un-jeton`);
    expect(takeLinkToken()).toBeNull();
    expect(location.hash).toBe('');
  });

  it('gives none without a fragment', () => {
    history.replaceState(null, '', LINK_PATH);
    expect(takeLinkToken()).toBeNull();
  });

  it('leaves the fragment of another page alone', () => {
    history.replaceState(null, '', `/idees#${TOKEN}`);
    expect(takeLinkToken()).toBeNull();
    expect(location.hash).toBe(`#${TOKEN}`);
  });
});

describe('the sign-in link’s page', () => {
  it('is ready with a token, and posts nothing before « Se connecter »', () => {
    const opts = options();
    const page = createConnexionLien(opts);
    expect(valid(page.view())).toEqual({ state: 'ready' });
    expect(opts.verifyLink).not.toHaveBeenCalled();
  });

  it('is invalid without a token, and confirm posts nothing', async () => {
    const opts = options({ token: null });
    const page = createConnexionLien(opts);
    expect(valid(page.view())).toEqual({ state: 'invalid' });
    await page.confirm();
    expect(opts.verifyLink).not.toHaveBeenCalled();
  });

  it('confirm posts the token with the browser’s time zone, busy, then leaves for the page the server gives', async () => {
    let answer!: (verified: { next: string }) => void;
    const verifyLink = vi.fn<(token: string, timeZone: string) => Promise<{ next: string }>>(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const opts = options({ verifyLink });
    const page = createConnexionLien(opts);
    const changes = vi.fn<() => void>();
    page.subscribe(changes);
    const done = page.confirm();
    expect(verifyLink).toHaveBeenCalledWith(TOKEN, 'Europe/Paris');
    expect(valid(page.view())).toEqual({ state: 'busy' });
    expect(changes).toHaveBeenCalledOnce();
    await page.confirm();
    expect(verifyLink).toHaveBeenCalledOnce();
    answer({ next: '/demarrage' });
    await done;
    expect(opts.leave).toHaveBeenCalledWith('/demarrage');
  });

  it('a link the server refuses is invalid, and confirm posts nothing again', async () => {
    const opts = options({ verifyLink: vi.fn<(token: string, timeZone: string) => Promise<{ next: string }>>().mockRejectedValue(INVALID) });
    const page = createConnexionLien(opts);
    await page.confirm();
    expect(valid(page.view())).toEqual({ state: 'invalid' });
    expect(opts.leave).not.toHaveBeenCalled();
    await page.confirm();
    expect(opts.verifyLink).toHaveBeenCalledOnce();
  });

  it('another failure reaches the page’s error, the page ready to try again', async () => {
    const down = new ApiError({ status: 502, code: 'api.unreadable', message: 'Le serveur ne répond pas, réessaie dans un instant.' });
    const opts = options({ verifyLink: vi.fn<(token: string, timeZone: string) => Promise<{ next: string }>>().mockRejectedValue(down) });
    const page = createConnexionLien(opts);
    await expect(page.confirm()).rejects.toBe(down);
    expect(valid(page.view())).toEqual({ state: 'ready' });
  });

  it('restart goes back to /connexion', () => {
    const opts = options({ token: null });
    createConnexionLien(opts).restart();
    expect(opts.navigate).toHaveBeenCalledWith('/connexion');
  });
});
