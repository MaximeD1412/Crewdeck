import { COMPOSANTS } from '@crewdeck/sdk';
import { ApiError } from '../api/request.js';
import { connexionView, createConnexion } from './connexion.js';

const INVALID = new ApiError({
  status: 400,
  code: 'validation.invalid',
  message: 'Requête invalide.',
  fields: { email: 'Adresse e-mail invalide.' },
});
const TOO_MANY = new ApiError({ status: 429, code: 'auth.too-many-requests', message: 'Trop de liens demandés : réessaie dans une heure.' });
const MAIL_DOWN = new ApiError({ status: 500, code: 'auth.mail-unavailable', message: 'L’e-mail n’a pas pu partir, réessaie dans un instant.' });

const valid = (view: unknown) => COMPOSANTS.PageConnexion.data.parse(view);

/** A promise and the means to settle it, for what happens while a request is out. */
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('connexionView', () => {
  it.each([
    ['state-mismatch', 'state-mismatch'],
    ['denied', 'denied'],
    ['github-unavailable', 'github-unavailable'],
    ['autre', null],
  ])('reads the error of ?erreur=%s, the form empty', (erreur, error) => {
    expect(valid(connexionView({ erreur }))).toEqual({ error, sentTo: null, emailError: null, busy: false });
  });
});

describe('the sign-in form', () => {
  it('requests a link with the address and the page to come back to, busy until it is sent, then says where it went', async () => {
    const sent = deferred();
    const requestLink = vi.fn<(email: string, next: string) => Promise<void>>().mockReturnValue(sent.promise);
    const connexion = createConnexion({ requestLink });
    const changes = vi.fn<() => void>();
    connexion.subscribe(changes);

    const done = connexion.requestLink(' pilote@example.com ', '/idees');
    expect(requestLink).toHaveBeenCalledWith(' pilote@example.com ', '/idees');
    expect(valid(connexion.view({}))).toEqual({ error: null, sentTo: null, emailError: null, busy: true });
    sent.resolve();
    await done;
    expect(valid(connexion.view({}))).toEqual({ error: null, sentTo: 'pilote@example.com', emailError: null, busy: false });
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('asks nothing again while a request is out', async () => {
    const sent = deferred();
    const requestLink = vi.fn<(email: string, next: string) => Promise<void>>().mockReturnValue(sent.promise);
    const connexion = createConnexion({ requestLink });
    const first = connexion.requestLink('pilote@example.com', '/a-toi');
    await connexion.requestLink('pilote@example.com', '/a-toi');
    expect(requestLink).toHaveBeenCalledOnce();
    sent.resolve();
    await first;
  });

  it('shows the field’s error of a 400 under the field', async () => {
    const connexion = createConnexion({ requestLink: () => Promise.reject(INVALID) });
    await connexion.requestLink('pilote@', '/a-toi');
    expect(valid(connexion.view({}))).toEqual({ error: null, sentTo: null, emailError: 'Adresse e-mail invalide.', busy: false });
  });

  it.each([
    [TOO_MANY, 'too-many-requests'],
    [MAIL_DOWN, 'mail-unavailable'],
  ] as const)('shows the banner of %s', async (refusal, error) => {
    const connexion = createConnexion({ requestLink: () => Promise.reject(refusal) });
    await connexion.requestLink('pilote@example.com', '/a-toi');
    expect(valid(connexion.view({}))).toEqual({ error, sentTo: null, emailError: null, busy: false });
  });

  it('lets any other failure reach the page’s error, the form ready again', async () => {
    const down = new ApiError({ status: 502, code: 'api.unreadable', message: 'Le serveur ne répond pas, réessaie dans un instant.' });
    const connexion = createConnexion({ requestLink: () => Promise.reject(down) });
    await expect(connexion.requestLink('pilote@example.com', '/a-toi')).rejects.toBe(down);
    expect(valid(connexion.view({}))).toEqual({ error: null, sentTo: null, emailError: null, busy: false });
  });

  it('a new request clears the error of the callback and the last refusal', async () => {
    const requestLink = vi.fn<(email: string, next: string) => Promise<void>>().mockRejectedValueOnce(INVALID).mockResolvedValueOnce();
    const connexion = createConnexion({ requestLink });
    expect(connexion.view({ erreur: 'denied' }).error).toBe('denied');
    await connexion.requestLink('pilote@', '/a-toi');
    expect(connexion.view({ erreur: 'denied' })).toMatchObject({ error: null, emailError: 'Adresse e-mail invalide.' });
    await connexion.requestLink('pilote@example.com', '/a-toi');
    expect(connexion.view({ erreur: 'denied' })).toMatchObject({ error: null, emailError: null, sentTo: 'pilote@example.com' });
  });

  it('changeEmail brings the field back', async () => {
    const connexion = createConnexion({ requestLink: () => Promise.resolve() });
    await connexion.requestLink('pilote@example.com', '/a-toi');
    const changes = vi.fn<() => void>();
    connexion.subscribe(changes);
    connexion.changeEmail();
    expect(valid(connexion.view({}))).toEqual({ error: null, sentTo: null, emailError: null, busy: false });
    expect(changes).toHaveBeenCalledOnce();
  });
});
