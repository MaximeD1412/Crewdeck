import type { z } from 'zod';
import { zBranch, zCheckRun, zCombinedStatus, zIssue, zIssueRef, zLabel, zPullRequest, zRepoRef } from '../index.js';

/** What the server never carries (ADR 0002): a body, a diff, a file's content. */
const CONTENT_KEYS = ['body', 'bodyText', 'bodyHtml', 'patch', 'diff', 'content'];

const keysOf = (schema: z.ZodObject): string[] => Object.keys(schema.shape);

describe('the GitHub types the server maps', () => {
  it.each([
    ['zIssue', zIssue],
    ['zIssueRef', zIssueRef],
    ['zPullRequest', zPullRequest],
    ['zCheckRun', zCheckRun],
    ['zCombinedStatus', zCombinedStatus],
    ['zLabel', zLabel],
    ['zBranch', zBranch],
  ] as const)('%s has no body, diff nor content', (_, schema) => {
    expect(keysOf(schema).filter((key) => CONTENT_KEYS.includes(key))).toEqual([]);
  });

  it('keeps an issue to its metadata', () => {
    expect(keysOf(zIssue).sort()).toEqual(['labels', 'milestone', 'number', 'state', 'title', 'updatedAt']);
  });

  it('keeps a PR to its metadata', () => {
    expect(keysOf(zPullRequest).sort()).toEqual(['baseRef', 'draft', 'headRef', 'headSha', 'labels', 'merged', 'number', 'state', 'title', 'updatedAt']);
  });

  it('drops the body of a payload it parses', () => {
    const issue = { number: 3, title: 'Un ticket', state: 'open', labels: [], milestone: null, updatedAt: '2026-11-10T12:00:00Z', body: 'secret' };

    expect(zIssue.parse(issue)).not.toHaveProperty('body');
  });

  it('refers to a repository by its owner, name and id', () => {
    expect(zRepoRef.parse({ owner: 'o', name: 'r', id: 1 })).toEqual({ owner: 'o', name: 'r', id: 1 });
    expect(zRepoRef.safeParse({ owner: 'o', name: 'r' }).success).toBe(false);
  });

  it('takes a SHA of 40 hexadecimal characters', () => {
    expect(zBranch.safeParse({ name: 'main', sha: 'abc', protected: false }).success).toBe(false);
    expect(zBranch.safeParse({ name: 'main', sha: 'a'.repeat(40), protected: false }).success).toBe(true);
  });
});
