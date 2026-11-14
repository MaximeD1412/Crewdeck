import { ApiError } from './request.js';
import { logout, me, requestLink, verifyLink } from './auth.js';

const ME = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', displayName: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done', identities: [] };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the auth client', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('gives the Pilote signed in', async () => {
    fetchMock.mockResolvedValueOnce(json(200, ME));
    await expect(me()).resolves.toEqual(ME);
    expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.objectContaining({ method: 'GET' }));
  });

  it('gives null when nobody is signed in', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { status: 401, code: 'auth.required', message: 'Connecte-toi.' }));
    await expect(me()).resolves.toBeNull();
  });

  it('throws the API’s error, its message as is, for another failure', async () => {
    fetchMock.mockResolvedValueOnce(json(500, { status: 500, code: 'server.internal', message: 'Une erreur est survenue.' }));
    const error = await me().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 500, code: 'server.internal', message: 'Une erreur est survenue.' });
  });

  it('signs out with a POST', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await logout();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
  });

  it('asks for a sign-in link with the address and the page to come back to', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await requestLink('pilote@example.com', '/idees');
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/email', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ email: 'pilote@example.com', next: '/idees' });
  });

  it('throws the refusal of a link’s request, its fields included', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, { status: 400, code: 'validation.invalid', message: 'Requête invalide.', fields: { email: 'Adresse e-mail invalide.' } }),
    );
    await expect(requestLink('pilote@', '/a-toi')).rejects.toMatchObject({ status: 400, fields: { email: 'Adresse e-mail invalide.' } });
  });

  it('signs in with a link’s token and the browser’s time zone, giving the page to go to', async () => {
    const token = 'a'.repeat(43);
    fetchMock.mockResolvedValueOnce(json(200, { next: '/demarrage' }));
    await expect(verifyLink(token, 'Europe/Paris')).resolves.toEqual({ next: '/demarrage' });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/email/verify', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ token, timeZone: 'Europe/Paris' });
  });
});

describe('an answer that is not the API’s', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is an ApiError saying the server does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })));
    await expect(me()).rejects.toMatchObject({ status: 502, code: 'api.unreadable', message: 'Le serveur ne répond pas, réessaie dans un instant.' });
  });
});
