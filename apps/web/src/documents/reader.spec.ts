import type { ArtifactKind, ArtifactPlaintextOf, ArtifactReadRefOf, ArtifactTicket } from '@crewdeck/contracts';
import { QueryObserver } from '@tanstack/query-core';
import { ArtifactUnavailable, DOCUMENT_GC_MS, DOCUMENT_STALE_MS, type DocumentFetcher, createDocumentReader, documentKey } from './reader.js';

const PROJECT = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d21';
const TICKET: ArtifactTicket = {
  number: 12,
  title: 'Le panier',
  body: 'Corps',
  state: 'OPEN',
  stateReason: '',
  labels: [],
  milestone: null,
  comments: [],
  blockedBy: [],
  parent: null,
};

/** A fetcher answering each call with the next of `answers` (a value, or an error to reject with). */
const fetcher = (...answers: unknown[]) => {
  const calls: { projectId: string; kind: ArtifactKind; ref: unknown }[] = [];
  const double: DocumentFetcher & { calls: typeof calls } = {
    calls,
    fetch: <K extends ArtifactKind>(projectId: string, kind: K, ref: ArtifactReadRefOf<K>): Promise<ArtifactPlaintextOf<K>> => {
      calls.push({ projectId, kind, ref });
      const answer = answers.length > 1 ? answers.shift() : answers[0];
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer as ArtifactPlaintextOf<K>);
    },
  };
  return double;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('the document reader', () => {
  it('reads from the fetcher of the Source the caller names, and answers ready with its value', async () => {
    const github = fetcher(TICKET);
    const local = fetcher(TICKET);
    const reader = createDocumentReader({ fetchers: { github, local } });

    expect(await reader.read({ projectId: PROJECT, source: 'local', kind: 'ticket', ref: { number: 12 } })).toEqual({ state: 'ready', value: TICKET });
    expect(local.calls).toEqual([{ projectId: PROJECT, kind: 'ticket', ref: { number: 12 } }]);
    expect(github.calls).toEqual([]);
  });

  it('keys every artefact by projectId, kind and ref, whatever its Source: a fresh one is not fetched again', async () => {
    const github = fetcher(TICKET);
    const local = fetcher(TICKET);
    const reader = createDocumentReader({ fetchers: { github, local } });

    const github12 = reader.documentQuery({ projectId: PROJECT, source: 'github', kind: 'ticket', ref: { number: 12 } });
    const local12 = reader.documentQuery({ projectId: PROJECT, source: 'local', kind: 'ticket', ref: { number: 12 } });
    expect(github12.queryKey).toEqual(['artifact', PROJECT, 'ticket', { number: 12 }]);
    expect(local12.queryKey).toEqual(github12.queryKey);
    expect(documentKey(PROJECT, 'file', { path: 'docs/prd.md', at: 'develop' })).toEqual(['artifact', PROJECT, 'file', { path: 'docs/prd.md', at: 'develop' }]);

    await reader.read({ projectId: PROJECT, source: 'github', kind: 'ticket', ref: { number: 12 } });
    await reader.read({ projectId: PROJECT, source: 'github', kind: 'ticket', ref: { number: 12 } });
    expect(github.calls).toHaveLength(1);
  });

  it('answers unavailable with the fetcher’s reason, and asks again at the next read', async () => {
    const local = fetcher(new ArtifactUnavailable('runner-offline'), TICKET);
    const reader = createDocumentReader({ fetchers: { github: fetcher(), local } });
    const request = { projectId: PROJECT, source: 'local', kind: 'ticket', ref: { number: 12 } } as const;

    expect(await reader.read(request)).toEqual({ state: 'unavailable', reason: 'runner-offline' });
    expect(await reader.read(request)).toEqual({ state: 'ready', value: TICKET });
    expect(local.calls).toHaveLength(2);
  });

  it('rejects, without retrying, what is a failure rather than an artefact not there', async () => {
    const github = fetcher(new Error('réseau'));
    const reader = createDocumentReader({ fetchers: { github, local: fetcher() } });

    await expect(reader.read({ projectId: PROJECT, source: 'github', kind: 'ticket', ref: { number: 12 } })).rejects.toThrow('réseau');
    expect(github.calls).toHaveLength(1);
  });

  it('reads it again once 30 s old, and drops it 5 min after its last observer', async () => {
    vi.useFakeTimers();
    const github = fetcher(TICKET);
    const reader = createDocumentReader({ fetchers: { github, local: fetcher() } });
    const request = { projectId: PROJECT, source: 'github', kind: 'ticket', ref: { number: 12 } } as const;

    await reader.read(request);
    vi.advanceTimersByTime(DOCUMENT_STALE_MS - 1);
    await reader.read(request);
    expect(github.calls).toHaveLength(1);
    vi.advanceTimersByTime(1);
    await reader.read(request);
    expect(github.calls).toHaveLength(2);

    const observer = new QueryObserver(reader.client, reader.documentQuery(request));
    const unsubscribe = observer.subscribe(() => undefined);
    vi.advanceTimersByTime(DOCUMENT_GC_MS + 1);
    expect(reader.client.getQueryData(documentKey(PROJECT, 'ticket', { number: 12 }))).toEqual({ state: 'ready', value: TICKET });
    unsubscribe();
    vi.advanceTimersByTime(DOCUMENT_GC_MS - 1);
    expect(reader.client.getQueryData(documentKey(PROJECT, 'ticket', { number: 12 }))).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(reader.client.getQueryData(documentKey(PROJECT, 'ticket', { number: 12 }))).toBeUndefined();
  });

  it('keeps nothing in the page’s storage', async () => {
    const before = { local: localStorage.length, session: sessionStorage.length };
    const reader = createDocumentReader({ fetchers: { github: fetcher(TICKET), local: fetcher() } });
    await reader.read({ projectId: PROJECT, source: 'github', kind: 'ticket', ref: { number: 12 } });

    expect({ local: localStorage.length, session: sessionStorage.length }).toEqual(before);
  });
});
