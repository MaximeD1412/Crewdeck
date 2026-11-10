import { ALLOWLISTED_PATHS } from '@crewdeck/contracts';
import type { Octokit } from '@octokit/core';

/**
 * Thrown before a request leaves the server when it would read a file, a
 * diff or a tree outside the allowlist of ADR 0002. A bug of ours, never the
 * Pilote's: the global filter renders it as a 500 and logs it.
 */
export class GitHubReadForbiddenError extends Error {
  constructor(method: string, path: string, why: string) {
    super(`The server never reads this from GitHub (ADR 0002): ${method} ${path}, ${why}`);
    this.name = 'GitHubReadForbiddenError';
  }
}

/** Routes that return a repository's content, whatever their method: diffs, blobs, trees, archives, GraphQL. */
const CONTENT_ROUTES: readonly [RegExp, string][] = [
  [/\/repos\/[^/]+\/[^/]+\/pulls\/[^/]+\/files\/?$/, 'the files of a PR'],
  [/\/repos\/[^/]+\/[^/]+\/compare(\/|$)/, 'a comparison'],
  [/\/repos\/[^/]+\/[^/]+\/git\/blobs(\/|$)/, 'a blob'],
  [/\/repos\/[^/]+\/[^/]+\/git\/trees(\/|$)/, 'a tree'],
  [/\/repos\/[^/]+\/[^/]+\/readme(\/|$)/, 'a README'],
  [/\/repos\/[^/]+\/[^/]+\/(tarball|zipball)(\/|$)/, 'an archive'],
  [/\/graphql\/?$/, 'GraphQL, which reads anything'],
];

const CONTENTS = /\/repos\/[^/]+\/[^/]+\/contents(?:\/(.*))?$/;

/** The media types of a content: `application/vnd.github.diff`, `.v3.patch`, `.raw+json`… */
const CONTENT_MEDIA_TYPE = /(^|[./+])(diff|patch|raw)($|[.+;])/i;

/** The path under `contents/`, decoded, without a trailing slash; undefined when it has an empty, `.` or `..` segment. */
const contentsPath = (encoded: string): string | undefined => {
  let path: string;
  try {
    path = decodeURIComponent(encoded).replace(/\/$/, '');
  } catch {
    return undefined;
  }
  return path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ? undefined : path;
};

/** Why a request is refused, or undefined when it may go. */
export const forbiddenReason = (method: string, url: string, accept: string | undefined): string | undefined => {
  const path = new URL(url).pathname;
  for (const [route, what] of CONTENT_ROUTES) if (route.test(path)) return what;
  const contents = CONTENTS.exec(path);
  if (contents) {
    const file = contentsPath(contents[1] ?? '');
    const allowed: readonly string[] = method === 'GET' ? ALLOWLISTED_PATHS : ['.process.json'];
    if (file === undefined || !allowed.includes(file)) return method === 'GET' ? 'a file outside the allowlist' : 'a write of a file other than .process.json';
  }
  if (accept?.split(',').some((type) => CONTENT_MEDIA_TYPE.test(type.trim().split(';')[0] ?? ''))) return `the media type ${accept}`;
  return undefined;
};

/**
 * The second fence of ADR 0002, after the interface of `GitHubClient`: a hook
 * run before every request of `octokit`, which throws `GitHubReadForbiddenError`
 * for a file outside `.process.json`, `CONTEXT.md` and `docs/adr`, a PR's files,
 * a comparison, a blob, a tree, a README, an archive, GraphQL, or an `accept`
 * asking for a diff, a patch or a raw content.
 */
export const installReadGuard = (octokit: Pick<Octokit, 'hook' | 'request'>): void => {
  octokit.hook.before('request', (options) => {
    const { method, url, headers } = octokit.request.endpoint.parse(options);
    const accept = headers['accept'];
    const why = forbiddenReason(method, url, typeof accept === 'string' ? accept : undefined);
    if (why !== undefined) throw new GitHubReadForbiddenError(method, new URL(url).pathname, why);
  });
};
