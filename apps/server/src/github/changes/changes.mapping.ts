import type { GitHubChangeKind } from '@crewdeck/contracts';
import type { WebhookPayload } from '../webhooks/payload.js';

/**
 * What the server keeps of a webhook for the Runner's Miroir (ADR 0010):
 * the repository, the kind of object, and the identifiers that name it.
 * Never a title, a body, a label's name nor a branch other than `ref`
 * (ADR 0003); a field the payload does not give is null.
 */
export interface ChangeFacts {
  readonly githubRepoId: number;
  readonly kind: GitHubChangeKind;
  readonly number: number | null;
  readonly sha: string | null;
  readonly ref: string | null;
  readonly action: string | null;
}

const isObject = (value: unknown): value is WebhookPayload => typeof value === 'object' && value !== null && !Array.isArray(value);

const at = (value: unknown, ...path: string[]): unknown => path.reduce<unknown>((current, key) => (isObject(current) ? current[key] : undefined), value);

const positiveInt = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null);

const SHA = /^[0-9a-f]{40}$/;
const sha = (value: unknown): string | null => (typeof value === 'string' && SHA.test(value) ? value : null);

const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

/** The number of the one PR a check names, null when it names several or none. */
const onePullRequest = (check: unknown): number | null => {
  const list = at(check, 'pull_requests');
  return Array.isArray(list) && list.length === 1 ? positiveInt(at(list[0], 'number')) : null;
};

type Identifiers = Pick<ChangeFacts, 'kind'> & Partial<Pick<ChangeFacts, 'number' | 'sha' | 'ref'>>;

const pull = (payload: WebhookPayload): Identifiers => ({
  kind: 'pull',
  number: positiveInt(at(payload, 'pull_request', 'number')),
  sha: sha(at(payload, 'pull_request', 'head', 'sha')),
});

const check = (object: unknown): Identifiers => ({ kind: 'check', number: onePullRequest(object), sha: sha(at(object, 'head_sha')) });

/**
 * Each event the Miroir follows and what names its object: `sub_issues`
 * names the parent, `issue_dependencies` the blocked issue, the side whose
 * fetch rewrites the relation (MIROIR-3).
 */
const MAPPINGS: Readonly<Record<string, (payload: WebhookPayload) => Identifiers>> = {
  issues: (payload) => ({ kind: 'issue', number: positiveInt(at(payload, 'issue', 'number')) }),
  issue_comment: (payload) => ({
    kind: isObject(at(payload, 'issue', 'pull_request')) ? 'pull' : 'issue',
    number: positiveInt(at(payload, 'issue', 'number')),
  }),
  sub_issues: (payload) => ({ kind: 'issue', number: positiveInt(at(payload, 'parent_issue', 'number')) }),
  issue_dependencies: (payload) => ({ kind: 'issue', number: positiveInt(at(payload, 'blocked_issue', 'number')) }),
  pull_request: pull,
  pull_request_review: pull,
  pull_request_review_comment: pull,
  check_run: (payload) => check(at(payload, 'check_run')),
  check_suite: (payload) => check(at(payload, 'check_suite')),
  status: (payload) => ({ kind: 'check', sha: sha(at(payload, 'sha')) }),
  push: (payload) => ({ kind: 'push', ref: text(at(payload, 'ref')), sha: sha(at(payload, 'after')) }),
  release: () => ({ kind: 'release' }),
  label: () => ({ kind: 'label' }),
  milestone: (payload) => ({ kind: 'milestone', number: positiveInt(at(payload, 'milestone', 'number')) }),
};

/** The 14 webhooks' events whose envelope the server keeps (ADR 0010). */
export const CHANGE_EVENTS: readonly string[] = Object.keys(MAPPINGS);

/** Events without an `action`: theirs is null whatever the payload says. */
const WITHOUT_ACTION = new Set(['push', 'status']);

/**
 * The envelope's facts of the webhook `event` (`X-GitHub-Event`), read from
 * its payload in memory; null for an event the Miroir does not follow, or a
 * payload without `repository.id`.
 */
export const changeOf = (event: string, payload: WebhookPayload): ChangeFacts | null => {
  const map = Object.hasOwn(MAPPINGS, event) ? MAPPINGS[event] : undefined;
  const githubRepoId = positiveInt(at(payload, 'repository', 'id'));
  if (!map || githubRepoId === null) return null;
  const { kind, number = null, sha: commit = null, ref = null } = map(payload);
  return { githubRepoId, kind, number, sha: commit, ref, action: WITHOUT_ACTION.has(event) ? null : text(payload['action']) };
};
