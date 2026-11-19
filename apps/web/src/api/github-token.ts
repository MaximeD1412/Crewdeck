import { zGithubToken, type GithubToken } from '@crewdeck/contracts';
import { ApiError, request } from './request.js';

/** A token is asked again this long before it expires: a read started with it still finishes in time. */
const MARGIN_MS = 60_000;

/**
 * The Pilote has no GitHub linked (CORE-11, ADR 0014): 409 `github.not-linked`.
 * The page stays signed in; the reader offers « Relier GitHub » instead.
 */
export class GithubNotLinkedError extends ApiError {
  constructor(error: ApiError) {
    super({ status: error.status, code: error.code, message: error.message });
    this.name = 'GithubNotLinkedError';
  }
}

const notLinked = (error: unknown): never => {
  if (error instanceof ApiError && error.code === 'github.not-linked') throw new GithubNotLinkedError(error);
  throw error;
};

export interface GithubTokenSource {
  /** The Pilote's GitHub access token, to read GitHub from the page (ADR 0002); a `GithubNotLinkedError` without GitHub. */
  get(): Promise<string>;
  /** Forgets it: on sign-out. */
  clear(): void;
}

/**
 * The Pilote's GitHub access token, from `POST /api/github/token`, kept in
 * memory only (never in the page's storage) until a minute before it
 * expires; concurrent reads share one request, and a failure is not kept.
 */
export const createGithubToken = (): GithubTokenSource => {
  let cached: GithubToken | null = null;
  let pending: Promise<GithubToken> | null = null;
  // A token asked before a `clear()` is not kept after it.
  let generation = 0;

  const fresh = (token: GithubToken | null): token is GithubToken =>
    token !== null && Date.parse(token.expiresAt) - MARGIN_MS > Date.now();

  return {
    async get() {
      if (fresh(cached)) return cached.accessToken;
      pending ??= request('POST', '/api/github/token', zGithubToken)
        .catch(notLinked)
        .finally(() => (pending = null));
      const asked = generation;
      const token = await pending;
      if (asked === generation) cached = token;
      return token.accessToken;
    },
    clear() {
      cached = null;
      pending = null;
      generation += 1;
    },
  };
};

/** The page's one source: the content reads (documents, diffs, captures) take their token from it. */
export const githubToken = createGithubToken();
