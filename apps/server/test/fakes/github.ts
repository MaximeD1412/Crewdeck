import type { GitHubClient } from '../../src/github/github.client.js';
import { FakeGitHub as BaseFakeGitHub } from '../../src/testing/fake-github.js';

export type { FakeCall, FakePullRequestFile, FileContent, SeedIssue, SeedRepo } from '../../src/testing/fake-github.js';

/** The fake GitHub of `src/testing/`, with what a unit test asserts on it. */
export class FakeGitHub extends BaseFakeGitHub {
  /** Asserts `method` was called with exactly `args`, at least once. */
  expectCalled<M extends keyof GitHubClient>(method: M, args: Parameters<GitHubClient[M]>): void {
    expect(this.calls).toContainEqual({ method, args });
  }

  /** Asserts `method` was never called. */
  expectNotCalled(method: keyof GitHubClient): void {
    expect(this.calls.map((call) => call.method)).not.toContain(method);
  }
}
