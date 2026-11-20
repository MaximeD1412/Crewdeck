import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL_MERGE_OUTCOMES, zMergeLocal, zMergeLocalResult, zRunnerToServer, zServerToRunner } from '../index.js';

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(import.meta.dirname, `../../fixtures/runner/${name}.json`), 'utf8')) as Record<string, unknown>;

describe('merge.local', () => {
  it('is a message of the server, never of the Runner', () => {
    const message = fixture('merge.local');
    expect(zServerToRunner.parse(message)).toMatchObject({ type: 'merge.local', changeNumber: 3 });
    expect(zRunnerToServer.safeParse(message).success).toBe(false);
  });

  it('names the change by its number and the SHA every Verdict judged', () => {
    const message = fixture('merge.local');
    expect(zMergeLocal.safeParse({ ...message, sha: 'a1' }).success).toBe(false);
    expect(zMergeLocal.safeParse({ ...message, changeNumber: 0 }).success).toBe(false);
    expect(zMergeLocal.safeParse({ ...message, headRef: 'feat/3-x' }).success).toBe(false);
  });
});

describe('merge.local.result', () => {
  it('is a message of the Runner, never of the server', () => {
    const message = fixture('merge.local.result');
    expect(zRunnerToServer.parse(message)).toMatchObject({ type: 'merge.local.result', outcome: 'merged' });
    expect(zServerToRunner.safeParse(message).success).toBe(false);
  });

  it('has four outcomes, a merge SHA only when merged', () => {
    const message = fixture('merge.local.result');
    expect(LOCAL_MERGE_OUTCOMES).toEqual(['merged', 'conflict', 'blocked', 'stale']);
    expect(zMergeLocalResult.safeParse({ ...message, outcome: 'refused' }).success).toBe(false);
    const { mergeSha, ...unmerged } = message;
    expect(mergeSha).toMatch(/^[0-9a-f]{40}$/);
    expect(zMergeLocalResult.safeParse(unmerged).success).toBe(false);
    for (const outcome of ['conflict', 'blocked', 'stale']) {
      expect(zMergeLocalResult.safeParse({ ...unmerged, outcome }).success).toBe(true);
      expect(zMergeLocalResult.safeParse({ ...message, outcome }).success).toBe(false);
    }
  });

  it('never names a file', () => {
    expect(zMergeLocalResult.safeParse({ ...fixture('merge.local.result'), outcome: 'blocked', mergeSha: undefined, files: ['src/a.ts'] }).success).toBe(false);
  });
});
