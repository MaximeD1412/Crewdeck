import { createGithubToken } from './github-token.js';
import { ApiError } from './request.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const NOW = new Date('2026-11-11T10:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const MINUTE = 60_000;

describe('the GitHub token of the page', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('asks the server once, then keeps the token in memory until a minute before it expires', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { accessToken: 'ghu_1', expiresAt: at(10 * MINUTE) }));
    fetchMock.mockResolvedValueOnce(json(200, { accessToken: 'ghu_2', expiresAt: at(20 * MINUTE) }));
    const token = createGithubToken();

    await expect(token.get()).resolves.toBe('ghu_1');
    vi.setSystemTime(NOW.getTime() + 9 * MINUTE - 1);
    await expect(token.get()).resolves.toBe('ghu_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/github/token', expect.objectContaining({ method: 'POST' }));

    vi.setSystemTime(NOW.getTime() + 9 * MINUTE);
    await expect(token.get()).resolves.toBe('ghu_2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one request between concurrent reads', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { accessToken: 'ghu_1', expiresAt: at(10 * MINUTE) }));
    const token = createGithubToken();
    await expect(Promise.all([token.get(), token.get()])).resolves.toEqual(['ghu_1', 'ghu_1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps no failure: GitHub expired is thrown, and the next read asks again', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { status: 401, code: 'auth.github-expired', message: 'Ta connexion GitHub a expiré, reconnecte-toi.' }));
    fetchMock.mockResolvedValueOnce(json(200, { accessToken: 'ghu_1', expiresAt: at(10 * MINUTE) }));
    const token = createGithubToken();

    const error = await token.get().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'auth.github-expired' });
    await expect(token.get()).resolves.toBe('ghu_1');
  });

  it('forgets the token on clear (sign-out)', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { accessToken: 'ghu_1', expiresAt: at(10 * MINUTE) }));
    fetchMock.mockResolvedValueOnce(json(200, { accessToken: 'ghu_2', expiresAt: at(10 * MINUTE) }));
    const token = createGithubToken();
    await token.get();
    token.clear();
    await expect(token.get()).resolves.toBe('ghu_2');
  });

  it('does not keep a token asked before a clear', async () => {
    let answer: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    fetchMock.mockResolvedValueOnce(json(200, { accessToken: 'ghu_2', expiresAt: at(10 * MINUTE) }));
    const token = createGithubToken();
    const first = token.get();
    token.clear();
    answer(json(200, { accessToken: 'ghu_1', expiresAt: at(10 * MINUTE) }));
    await expect(first).resolves.toBe('ghu_1');
    await expect(token.get()).resolves.toBe('ghu_2');
  });
});
