import type { ArtifactErrorCode, ArtifactKind, ArtifactPlaintextOf, ArtifactReadRefOf } from '@crewdeck/contracts';
import { QueryClient, type QueryKey } from '@tanstack/query-core';

/**
 * The document reader's data (SOURCE-4, ADR 0012 « Reading content in the
 * page »): a file of the code, a Ticket, a change of code, a diff or a
 * Commande's output, read from GitHub with the Pilote's token for a GitHub
 * Source (ADR 0002), or from the Runner through the relay for a Local one,
 * both to the same shapes (`zArtifactPlaintexts`) under the same keys. No
 * screen here: PROJET-5's `DocumentReader` draws on it.
 *
 * Kept in this page's memory only (one `QueryClient`, never IndexedDB nor
 * localStorage): stale after 30 s, dropped 5 min after its last observer.
 */

/** Where an artefact is read from: given by the caller from the Projet's Source of its group (`ticket` for a Ticket, `code` for the others, `local` always for a Commande's output). */
export type DocumentSource = 'github' | 'local';

/** Why an artefact is not shown: a caller shows the title and state it already has instead. */
export type UnavailableReason = ArtifactErrorCode extends `artifact.${infer R}` ? R : never;

export type DocumentResult<K extends ArtifactKind> = { state: 'ready'; value: ArtifactPlaintextOf<K> } | { state: 'unavailable'; reason: UnavailableReason };

/** What a fetcher rejects with when the artefact is not there to read, as opposed to a failure (a network error, an answer that does not open). */
export class ArtifactUnavailable extends Error {
  constructor(readonly reason: UnavailableReason) {
    super(`artifact: ${reason}`);
    this.name = 'ArtifactUnavailable';
  }
}

/** The plaintext of `kind`, or `ArtifactUnavailable`. */
export interface DocumentFetcher {
  fetch<K extends ArtifactKind>(projectId: string, kind: K, ref: ArtifactReadRefOf<K>): Promise<ArtifactPlaintextOf<K>>;
}

export interface DocumentRequest<K extends ArtifactKind> {
  readonly projectId: string;
  readonly source: K extends 'command-output' ? 'local' : DocumentSource;
  readonly kind: K;
  readonly ref: ArtifactReadRefOf<K>;
}

export const DOCUMENT_STALE_MS = 30_000;
export const DOCUMENT_GC_MS = 5 * 60_000;

/** The key of an artefact, whatever its Source: `['artifact', projectId, kind, ref]`. */
export const documentKey = <K extends ArtifactKind>(projectId: string, kind: K, ref: ArtifactReadRefOf<K>): QueryKey => ['artifact', projectId, kind, ref];

/** The page's one `QueryClient` of documents: no retry (a fetcher says why it failed), nothing persisted. */
export const createDocumentClient = (): QueryClient => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: DOCUMENT_GC_MS } } });

export interface DocumentReader {
  readonly client: QueryClient;
  /** The options of `request`'s query, for `client.query` or a `QueryObserver`. */
  documentQuery<K extends ArtifactKind>(
    request: DocumentRequest<K>,
  ): {
    queryKey: QueryKey;
    queryFn: () => Promise<DocumentResult<K>>;
    staleTime: (query: { state: { data: DocumentResult<K> | undefined } }) => number;
    gcTime: number;
  };
  /** `request`'s result, from memory while fresh. */
  read<K extends ArtifactKind>(request: DocumentRequest<K>): Promise<DocumentResult<K>>;
}

export const createDocumentReader = ({
  fetchers,
  client = createDocumentClient(),
}: {
  fetchers: Readonly<Record<DocumentSource, DocumentFetcher>>;
  client?: QueryClient;
}): DocumentReader => {
  const documentQuery: DocumentReader['documentQuery'] = <K extends ArtifactKind>({ projectId, source, kind, ref }: DocumentRequest<K>) => ({
    queryKey: documentKey(projectId, kind, ref),
    queryFn: async (): Promise<DocumentResult<K>> => {
      try {
        return { state: 'ready', value: await fetchers[source].fetch(projectId, kind, ref) };
      } catch (error) {
        if (error instanceof ArtifactUnavailable) return { state: 'unavailable', reason: error.reason };
        throw error;
      }
    },
    // An artefact not there to read is asked again at once: the Runner may be back.
    staleTime: (query) => (query.state.data?.state === 'unavailable' ? 0 : DOCUMENT_STALE_MS),
    gcTime: DOCUMENT_GC_MS,
  });
  return {
    client,
    documentQuery,
    read: (request) => client.query(documentQuery(request)),
  };
};
