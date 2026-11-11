import { z } from 'zod';
import { createClient } from './client.js';
import { ApiError } from './request.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const zIdea = z.object({ id: z.string(), title: z.string() });
const STALE = { status: 409, code: 'realtime.stale', message: 'L’état a changé depuis ton dernier affichage : vérifie avant de recommencer.' };

describe('the API client', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const onStale = vi.fn<() => void>();
  let seq: bigint | null;
  const client = createClient({ seq: () => seq, onStale });

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    seq = 41n;
  });
  afterEach(() => {
    fetchMock.mockReset();
    onStale.mockReset();
    vi.unstubAllGlobals();
  });

  const sentBody = (call = 0): unknown => JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body));

  it('query: a GET with the session cookie, its answer read by the schema', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: 'i1', title: 'Une Idée', extra: true }));
    await expect(client.query('/api/ideas/i1', zIdea)).resolves.toEqual({ id: 'i1', title: 'Une Idée' });
    expect(fetchMock).toHaveBeenCalledWith('/api/ideas/i1', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }));
  });

  it('command: every body carries the store’s seq as a decimal string, sent as JSON', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: 'i1', title: 'Une Idée' }));
    await expect(client.command('POST', '/api/ideas', { title: 'Une Idée' }, zIdea)).resolves.toEqual({ id: 'i1', title: 'Une Idée' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ideas',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin', headers: expect.objectContaining({ 'content-type': 'application/json' }) }),
    );
    expect(sentBody()).toEqual({ title: 'Une Idée', seq: '41' });

    seq = 9_007_199_254_740_993n;
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(client.command('DELETE', '/api/ideas/i1', {})).resolves.toBeUndefined();
    expect(sentBody(1)).toEqual({ seq: '9007199254740993' });
  });

  it('command before any snapshot carries seq 0: the server then answers what changed', async () => {
    seq = null;
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await client.command('PATCH', '/api/settings', { a: 1 });
    expect(sentBody()).toEqual({ a: 1, seq: '0' });
  });

  it('parses the error envelope into an ApiError, its message as is, its fields', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, { status: 400, code: 'validation.failed', message: 'Vérifie le formulaire.', fields: { title: 'Le titre est requis.' } }),
    );
    const error = await client.command('POST', '/api/ideas', { title: '' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'validation.failed', message: 'Vérifie le formulaire.', fields: { title: 'Le titre est requis.' } });
    expect(onStale).not.toHaveBeenCalled();
  });

  it('a 409 realtime.stale triggers the catch-up, and is still thrown with its message', async () => {
    fetchMock.mockResolvedValueOnce(json(409, STALE));
    const error = await client.command('POST', '/api/ideas/i1/retain', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject(STALE);
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it('another 409 does not', async () => {
    fetchMock.mockResolvedValueOnce(json(409, { status: 409, code: 'idea.already-retained', message: 'Cette Idée est déjà retenue.' }));
    await client.command('POST', '/api/ideas/i1/retain', {}).catch(() => undefined);
    expect(onStale).not.toHaveBeenCalled();
  });
});
