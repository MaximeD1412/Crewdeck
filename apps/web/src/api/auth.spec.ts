import { ApiError } from './request.js';
import { logout, me } from './auth.js';

const ME = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', login: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris' };

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
});

describe('an answer that is not the API’s', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is an ApiError saying the server does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })));
    await expect(me()).rejects.toMatchObject({ status: 502, code: 'api.unreadable', message: 'Le serveur ne répond pas, réessaie dans un instant.' });
  });
});
