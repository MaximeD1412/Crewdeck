import {
  ARTIFACT_PLAINTEXT_MAX,
  type ArtifactComment,
  type ArtifactKind,
  type ArtifactPlaintextOf,
  type ArtifactReadRefOf,
  type ArtifactReadRefs,
  zArtifactPlaintexts,
} from '@crewdeck/contracts';
import type { GithubTokenSource } from '../api/github-token.js';
import { ArtifactUnavailable, type DocumentFetcher } from './reader.js';

/** The repository of a GitHub Projet, from the page's state; `null` for a Projet it does not know. */
export interface GithubRepository {
  readonly owner: string;
  readonly name: string;
  /** Where a `file` without `at` is read, as the Runner does for a Local Projet. */
  readonly integrationBranch: string;
}

/** GitHub answered something else than the artefact or its absence: a failure, not an artefact absent. */
export class GithubReadError extends Error {
  constructor(readonly status: number) {
    super(`github: ${status}`);
    this.name = 'GithubReadError';
  }
}

const API = 'https://api.github.com';
const JSON_ACCEPT = 'application/vnd.github+json';
const DIFF_ACCEPT = 'application/vnd.github.diff';
const RAW_ACCEPT = 'application/vnd.github.raw+json';
const PER_PAGE = 100;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

interface GithubUser {
  login: string;
}
interface GithubComment {
  user: GithubUser | null;
  body?: string | null;
  created_at?: string | null;
}
interface GithubIssue {
  number: number;
  title: string;
  body?: string | null;
  state: 'open' | 'closed';
  state_reason?: string | null;
  labels: (string | { name?: string })[];
  milestone: { number: number; title: string; description?: string | null; due_on?: string | null } | null;
  pull_request?: unknown;
}
interface GithubPull {
  number: number;
  title: string;
  body?: string | null;
  state: 'open' | 'closed';
  merged_at?: string | null;
  head: { ref: string; sha: string };
  base: { ref: string };
}
interface GithubReview {
  user: GithubUser | null;
  state: string;
  body?: string | null;
  submitted_at?: string | null;
  commit_id?: string | null;
}
interface GithubContent {
  type: string;
  path: string;
  sha: string;
  size: number;
  encoding?: string;
  content?: string;
}

/**
 * The GitHub fetcher (SOURCE-4, ADR 0002): a GitHub Projet's artefacts read
 * by the page with the Pilote's user token, mapped to the shapes the Runner
 * answers for a Local Projet (`gh … view --json`'s): `file` through the
 * contents (its blob's SHA, that blob's raw bytes past GitHub's 1 MB), `ticket`
 * through the issue, its comments, what blocks it and its parent, `change`
 * through the pull request, its reviews and comments, `diff` as GitHub's
 * unified diff. A 404 is `not-found`; more than `ARTIFACT_PLAINTEXT_MAX` of
 * plaintext is `too-large`, as on the Runner. A Commande's output is never
 * GitHub's.
 */
export const createGithubFetcher = ({
  token,
  repository,
  fetch: fetchImpl = (input, init) => globalThis.fetch(input, init),
  api = API,
}: {
  token: Pick<GithubTokenSource, 'get'>;
  repository: (projectId: string) => GithubRepository | null;
  fetch?: Fetch;
  api?: string;
}): DocumentFetcher => {
  const call = async (path: string, accept: string): Promise<Response> => {
    const response = await fetchImpl(`${api}${path}`, {
      headers: { authorization: `Bearer ${await token.get()}`, accept, 'x-github-api-version': '2022-11-28' },
    });
    if (response.status === 404) throw new ArtifactUnavailable('not-found');
    if (!response.ok) throw new GithubReadError(response.status);
    return response;
  };
  const json = async <T>(path: string): Promise<T> => (await call(path, JSON_ACCEPT)).json() as Promise<T>;
  /** Every page of a list, following its `Link: rel="next"`. */
  const all = async <T>(path: string): Promise<T[]> => {
    const items: T[] = [];
    let next: string | null = `${path}${path.includes('?') ? '&' : '?'}per_page=${PER_PAGE}`;
    while (next !== null) {
      const response = await call(next, JSON_ACCEPT);
      items.push(...((await response.json()) as T[]));
      next = nextPage(response.headers.get('link'), api);
    }
    return items;
  };
  /** An absent relation (a 404: the feature off, or none) is empty. */
  const optional = async <T>(read: () => Promise<T>, absent: T): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      if (error instanceof ArtifactUnavailable) return absent;
      throw error;
    }
  };
  const diffText = async (path: string): Promise<string> => {
    try {
      return await (await call(path, DIFF_ACCEPT)).text();
    } catch (error) {
      // GitHub refuses a diff past its own limits, and a comparison of refs it does not know.
      if (error instanceof GithubReadError && error.status === 406) throw new ArtifactUnavailable('too-large');
      if (error instanceof GithubReadError && error.status === 422) throw new ArtifactUnavailable('not-found');
      throw error;
    }
  };

  const readers: { [K in ArtifactKind]: (repo: string, ref: ArtifactReadRefs[K], project: GithubRepository) => Promise<unknown> } = {
    file: async (repo, { path, at }, project) => {
      if (!validPath(path)) throw new ArtifactUnavailable('not-found');
      const contentsPath = `${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(at ?? project.integrationBranch)}`;
      const content = await json<GithubContent | GithubContent[]>(contentsPath);
      if (Array.isArray(content) || content.type !== 'file') throw new ArtifactUnavailable('not-found');
      if (content.size > ARTIFACT_PLAINTEXT_MAX) throw new ArtifactUnavailable('too-large');
      // Past 1 MB GitHub sends no content in the JSON: the raw bytes of that
      // very blob then, never the branch's again (it may have moved on).
      const bytes =
        content.encoding === 'base64' && content.content !== undefined
          ? fromBase64(content.content)
          : new Uint8Array(await (await call(`${repo}/git/blobs/${encodeURIComponent(content.sha)}`, RAW_ACCEPT)).arrayBuffer());
      const text = utf8Text(bytes);
      return text === null ? { path, sha: content.sha, content: toBase64(bytes), binary: true } : { path, sha: content.sha, content: text };
    },
    ticket: async (repo, { number }) => {
      const issue = await json<GithubIssue>(`${repo}/issues/${number}`);
      // GitHub's issues hold its pull requests too: those are changes, not Tickets.
      if (issue.pull_request !== undefined) throw new ArtifactUnavailable('not-found');
      const [comments, blockedBy, parent] = await Promise.all([
        all<GithubComment>(`${repo}/issues/${number}/comments`),
        optional(() => all<{ number: number }>(`${repo}/issues/${number}/dependencies/blocked_by`), []),
        optional(() => json<{ number: number }>(`${repo}/issues/${number}/parent`), null),
      ]);
      return {
        number: issue.number,
        title: issue.title,
        body: issue.body ?? '',
        state: issue.state === 'open' ? 'OPEN' : 'CLOSED',
        stateReason: issue.state === 'open' ? '' : (issue.state_reason ?? '').toUpperCase(),
        labels: issue.labels.map((label) => ({ name: typeof label === 'string' ? label : (label.name ?? '') })),
        milestone: issue.milestone && {
          number: issue.milestone.number,
          title: issue.milestone.title,
          description: issue.milestone.description ?? '',
          dueOn: issue.milestone.due_on ?? null,
        },
        comments: comments.map(comment),
        blockedBy: blockedBy.map((blocking) => blocking.number),
        parent: parent?.number ?? null,
      };
    },
    change: async (repo, { number }) => {
      const [pull, reviews, comments] = await Promise.all([
        json<GithubPull>(`${repo}/pulls/${number}`),
        all<GithubReview>(`${repo}/pulls/${number}/reviews`),
        all<GithubComment>(`${repo}/issues/${number}/comments`),
      ]);
      return {
        number: pull.number,
        title: pull.title,
        body: pull.body ?? '',
        state: pull.merged_at ? 'MERGED' : pull.state === 'open' ? 'OPEN' : 'CLOSED',
        headRefName: pull.head.ref,
        headRefOid: pull.head.sha,
        baseRefName: pull.base.ref,
        reviews: reviews.map((review) => ({
          author: review.user && { login: review.user.login },
          state: review.state,
          body: review.body ?? '',
          submittedAt: review.submitted_at ?? null,
          commit: review.commit_id ? { oid: review.commit_id } : null,
        })),
        comments: comments.map(comment),
      };
    },
    diff: async (repo, ref) => {
      if ('number' in ref) {
        const [pull, patch] = await Promise.all([json<GithubPull>(`${repo}/pulls/${ref.number}`), diffText(`${repo}/pulls/${ref.number}`)]);
        return { base: pull.base.ref, head: pull.head.ref, patch };
      }
      return { base: ref.base, head: ref.head, patch: await diffText(`${repo}/compare/${refPath(ref.base)}...${refPath(ref.head)}`) };
    },
    'command-output': () => Promise.reject(new ArtifactUnavailable('not-found')),
  };

  return {
    async fetch<K extends ArtifactKind>(projectId: string, kind: K, ref: ArtifactReadRefOf<K>): Promise<ArtifactPlaintextOf<K>> {
      const project = repository(projectId);
      if (project === null) throw new ArtifactUnavailable('not-found');
      const repo = `/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.name)}`;
      const value = zArtifactPlaintexts[kind].parse(await readers[kind](repo, ref, project));
      if (new TextEncoder().encode(JSON.stringify(value)).length > ARTIFACT_PLAINTEXT_MAX) throw new ArtifactUnavailable('too-large');
      return value as ArtifactPlaintextOf<K>;
    },
  };
};

const comment = ({ user, body, created_at }: GithubComment): ArtifactComment => ({
  author: user && { login: user.login },
  body: body ?? '',
  createdAt: created_at ?? null,
});

/** A path inside the repository, as the Runner takes it: relative, without `.` nor `..`. */
const validPath = (path: string): boolean => !path.startsWith('/') && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');

/** A branch in a URL's path: its `/` kept, the rest encoded. */
const refPath = (ref: string): string => encodeURIComponent(ref).replace(/%2F/g, '/');

/** The `next` of a `Link` header, relative to the API, or null; never a URL outside it. */
const nextPage = (link: string | null, api: string): string | null => {
  const next = link
    ?.split(',')
    .map((part) => /<([^>]+)>;\s*rel="next"/.exec(part)?.[1])
    .find((url) => url !== undefined);
  return next?.startsWith(`${api}/`) ? next.slice(api.length) : null;
};

const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text.replace(/\s/g, '')), (char) => char.charCodeAt(0));

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

/** The bytes as text when they are UTF-8 without a NUL, as the Runner decides; else null. */
const utf8Text = (bytes: Uint8Array): string | null => {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
};
