import { webhookFixture } from '../../../test/fakes/github.js';
import { CHANGE_EVENTS, type ChangeFacts, changeOf } from './changes.mapping.js';

const REPO_ID = 71000001;
const HEAD = '6dcb09b5b57875f334f61aebed695e2e4193db5e';
const MERGE = 'e5bd3914e2e596debea16f433f57875b5b90bcd6';

const facts = (rest: Partial<ChangeFacts>): ChangeFacts => ({ githubRepoId: REPO_ID, number: null, sha: null, ref: null, action: null, kind: 'issue', ...rest });

describe('changeOf, the envelope of a webhook', () => {
  it.each<[string, string, ChangeFacts]>([
    ['issues', 'issues', facts({ kind: 'issue', number: 42, action: 'opened' })],
    ['issue_comment', 'issue_comment', facts({ kind: 'issue', number: 42, action: 'created' })],
    ['issue_comment', 'issue_comment.pull', facts({ kind: 'pull', number: 43, action: 'created' })],
    ['sub_issues', 'sub_issues', facts({ kind: 'issue', number: 40, action: 'sub_issue_added' })],
    ['issue_dependencies', 'issue_dependencies', facts({ kind: 'issue', number: 42, action: 'blocked_by_added' })],
    ['pull_request', 'pull_request', facts({ kind: 'pull', number: 43, sha: HEAD, action: 'synchronize' })],
    ['pull_request_review', 'pull_request_review', facts({ kind: 'pull', number: 43, sha: HEAD, action: 'submitted' })],
    ['pull_request_review_comment', 'pull_request_review_comment', facts({ kind: 'pull', number: 43, sha: HEAD, action: 'created' })],
    ['check_run', 'check_run', facts({ kind: 'check', number: 43, sha: HEAD, action: 'completed' })],
    ['check_suite', 'check_suite', facts({ kind: 'check', number: null, sha: MERGE, action: 'completed' })],
    ['status', 'status', facts({ kind: 'check', sha: HEAD, action: null })],
    ['push', 'push', facts({ kind: 'push', ref: 'refs/heads/develop', sha: MERGE, action: null })],
    ['release', 'release', facts({ kind: 'release', action: 'published' })],
    ['label', 'label', facts({ kind: 'label', action: 'created' })],
    ['milestone', 'milestone', facts({ kind: 'milestone', number: 7, action: 'closed' })],
  ])('maps %s (fixture %s)', (event, fixture, expected) => {
    expect(changeOf(event, webhookFixture(fixture))).toEqual(expected);
  });

  it('subscribes to the 14 events of the Miroir, and to them only', () => {
    expect([...CHANGE_EVENTS].sort()).toEqual(
      [
        'issues',
        'issue_comment',
        'sub_issues',
        'issue_dependencies',
        'pull_request',
        'pull_request_review',
        'pull_request_review_comment',
        'check_run',
        'check_suite',
        'status',
        'push',
        'release',
        'label',
        'milestone',
      ].sort(),
    );
  });

  it('keeps no title, body, label name nor branch: only the envelope’s keys', () => {
    for (const event of CHANGE_EVENTS) {
      const fixture = webhookFixture(event);
      expect(Object.keys(changeOf(event, fixture) ?? {}).sort()).toEqual(['action', 'githubRepoId', 'kind', 'number', 'ref', 'sha']);
    }
  });

  it('names the one PR of a check, none when it has several or none', () => {
    const run = webhookFixture<{ check_run: Record<string, unknown> }>('check_run');
    const twice = { ...run, check_run: { ...run.check_run, pull_requests: [{ number: 43 }, { number: 44 }] } };
    const none = { ...run, check_run: { ...run.check_run, pull_requests: [] } };
    expect(changeOf('check_run', twice)?.number).toBeNull();
    expect(changeOf('check_run', none)?.number).toBeNull();
    const suite = webhookFixture<{ check_suite: Record<string, unknown> }>('check_suite');
    expect(changeOf('check_suite', { ...suite, check_suite: { ...suite.check_suite, pull_requests: [{ number: 44 }] } })?.number).toBe(44);
  });

  it('gives null for another event, or a payload without repository.id', () => {
    expect(changeOf('installation', webhookFixture('installation.created'))).toBeNull();
    expect(changeOf('ping', webhookFixture('ping'))).toBeNull();
    expect(changeOf('workflow_run', { action: 'completed', repository: { id: REPO_ID } })).toBeNull();
    const issues = webhookFixture('issues');
    expect(changeOf('issues', { ...issues, repository: { name: 'fixture-app' } })).toBeNull();
    expect(changeOf('issues', { ...issues, repository: undefined })).toBeNull();
  });

  it('gives null fields for what a payload lacks or gives in the wrong shape', () => {
    const pr = webhookFixture<{ pull_request: Record<string, unknown> }>('pull_request');
    expect(changeOf('pull_request', { ...pr, pull_request: { ...pr.pull_request, head: { sha: 'not-a-sha' } } })).toMatchObject({ number: 43, sha: null });
    expect(changeOf('issues', { repository: { id: REPO_ID }, action: 'opened' })).toEqual(facts({ kind: 'issue', action: 'opened' }));
  });
});
