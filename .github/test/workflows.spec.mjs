// When the nightly and the minutes' guard run, and what the nightly runs
// (INFRA-9), read from the workflows' text: actionlint checks their syntax,
// this checks the choices it cannot know.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const read = (name) => readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8');

/** The top-level block `key:` of a workflow, up to the next top-level key. */
const block = (text, key) => {
  const match = new RegExp(`^${key}:\\n((?:[ #].*\\n|\\n)*)`, 'm').exec(text);
  assert.ok(match, `no top-level « ${key}: »`);
  return match[1];
};

describe('nightly.yml', () => {
  const nightly = read('nightly.yml');
  const on = block(nightly, 'on');
  const jobs = block(nightly, 'jobs');

  test('runs at 03:30 UTC and from a manual dispatch, nothing else', () => {
    assert.match(on, /^ {2}schedule:\n(?: {4}#.*\n)* {4}- cron: '30 3 \* \* \*'\n/m);
    assert.match(on, /^ {2}workflow_dispatch:/m);
    assert.deepEqual(on.match(/^ {2}[\w-]+(?=:)/gm), ['  schedule', '  workflow_dispatch']);
  });

  test('calls verify.yml in full scope, on develop only', () => {
    assert.match(jobs, /^ {4}uses: \.\/\.github\/workflows\/verify\.yml$/m);
    assert.match(jobs, /^ {6}scope: full$/m);
    assert.match(jobs, /^ {4}if: github\.ref == 'refs\/heads\/develop'$/m);
  });

  test('a second run waits for the first instead of cancelling it', () => {
    assert.match(block(nightly, 'concurrency'), /^ {2}cancel-in-progress: false$/m);
  });
});

describe('actions-minutes.yml', () => {
  const minutes = read('actions-minutes.yml');

  test('runs daily at 06:17 UTC and from a manual dispatch', () => {
    const on = block(minutes, 'on');
    assert.match(on, /- cron: '17 6 \* \* \*'/);
    assert.match(on, /^ {2}workflow_dispatch:/m);
  });

  test('gives the script the token secret and the quota variable', () => {
    assert.match(minutes, /run: node \.github\/scripts\/actions-minutes\.mjs/);
    assert.match(minutes, /ACTIONS_BILLING_TOKEN: \$\{\{ secrets\.ACTIONS_BILLING_TOKEN \}\}/);
    assert.match(minutes, /ACTIONS_MINUTES_QUOTA: \$\{\{ vars\.ACTIONS_MINUTES_QUOTA \}\}/);
  });
});
