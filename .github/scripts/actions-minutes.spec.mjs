// The daily guard of the Actions minutes (INFRA-9): the pure functions, then
// the run as actions-minutes.yml makes it, with a fake billing API.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { DEFAULT_QUOTA, minutesOf, quotaOf, run, usage } from './actions-minutes.mjs';

// The 10th of a 30-day month.
const NOV_10 = new Date('2026-11-10T06:17:00Z');

describe('usage(used, quota, now)', () => {
  test('2 400 of 3 000 fails at 80 % of the quota', () => {
    const report = usage(2400, 3000, new Date('2026-11-30T06:17:00Z'));
    assert.equal(report.failure, '80 % du quota atteint');
  });

  test('1 000 on the 10th of a 30-day month passes', () => {
    const report = usage(1000, 3000, NOV_10);
    assert.equal(report.projection, 3000);
    assert.equal(report.failure, null);
  });

  test('1 200 on the 10th of a 30-day month fails on the projection', () => {
    const report = usage(1200, 3000, NOV_10);
    assert.equal(report.projection, 3600);
    assert.equal(report.failure, 'projection au-delà du quota');
  });

  test('a projection above the quota by less than half a minute still fails', () => {
    // 1 355 / 14 × 31 = 3 000.36: rounded, it would equal the quota.
    const report = usage(1355, 3000, new Date('2026-10-14T06:17:00Z'));
    assert.ok(report.projection > 3000);
    assert.equal(report.failure, 'projection au-delà du quota');
  });

  test('80 % is reached at exactly 0.8 × quota, not below', () => {
    const lastDay = new Date('2026-11-30T23:00:00Z');
    assert.equal(usage(2399, 3000, lastDay).failure, null);
    assert.equal(usage(2400, 3000, lastDay).failure, '80 % du quota atteint');
  });

  test('projects over the days of the month it is in', () => {
    // February 2027: 28 days; October: 31.
    assert.equal(usage(100, 3000, new Date('2027-02-01T06:00:00Z')).projection, 2800);
    assert.equal(usage(100, 3000, new Date('2026-10-01T06:00:00Z')).projection, 3100);
  });
});

describe('minutesOf(usageItems)', () => {
  test('adds up the Actions minutes, and nothing else', () => {
    const item = (product, unitType, quantity) => ({ date: '2026-11-09', product, unitType, quantity });
    const items = [
      item('actions', 'Minutes', 600),
      item('Actions', 'minutes', 400),
      item('actions', 'GigabyteHours', 50),
      item('git_lfs', 'Minutes', 999),
    ];
    assert.equal(minutesOf(items), 1000);
  });
});

describe('quotaOf(ACTIONS_MINUTES_QUOTA)', () => {
  test('defaults to 3 000 minutes', () => {
    assert.equal(DEFAULT_QUOTA, 3000);
    assert.equal(quotaOf(undefined), 3000);
    assert.equal(quotaOf(''), 3000);
    assert.equal(quotaOf('2000'), 2000);
  });

  test('refuses a quota it cannot read rather than watch another threshold', () => {
    for (const value of ['3 000', '0', '-5', 'abc']) {
      assert.throws(() => quotaOf(value), /ACTIONS_MINUTES_QUOTA/);
    }
  });
});

describe('run(env)', () => {
  const billing = (usageItems, calls = []) => async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ usageItems }), { status: 200 });
  };
  const env = {
    ACTIONS_BILLING_TOKEN: 'fake-token',
    GITHUB_REPOSITORY_OWNER: 'owner',
    ACTIONS_MINUTES_QUOTA: '3000',
  };
  const quietly = () => {
    const lines = [];
    return { lines, log: (line) => lines.push(line) };
  };

  test('reads the month of the account from the billing API and prints used, projection and quota', async () => {
    const calls = [];
    const { lines, log } = quietly();
    const code = await run({
      env,
      now: NOV_10,
      fetch: billing([{ product: 'actions', unitType: 'Minutes', quantity: 900 }], calls),
      log,
    });
    assert.equal(code, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.github.com/users/owner/settings/billing/usage?year=2026&month=11');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer fake-token');
    const output = lines.join('\n');
    assert.match(output, /900 \/ 3000/);
    assert.match(output, /2700 projetées/);
  });

  test('fails with « 80 % du quota atteint »', async () => {
    const { lines, log } = quietly();
    const code = await run({
      env,
      now: NOV_10,
      fetch: billing([{ product: 'actions', unitType: 'Minutes', quantity: 2400 }]),
      log,
    });
    assert.equal(code, 1);
    assert.match(lines.join('\n'), /::error::80 % du quota atteint/);
  });

  test('fails with « projection au-delà du quota »', async () => {
    const { lines, log } = quietly();
    const code = await run({
      env,
      now: NOV_10,
      fetch: billing([{ product: 'actions', unitType: 'Minutes', quantity: 1200 }]),
      log,
    });
    assert.equal(code, 1);
    assert.match(lines.join('\n'), /::error::projection au-delà du quota/);
  });

  test('prints the projection rounded up, so that a projection just above the quota does not read as equal', async () => {
    const { lines, log } = quietly();
    const code = await run({
      env,
      now: new Date('2026-10-14T06:17:00Z'),
      fetch: billing([{ product: 'actions', unitType: 'Minutes', quantity: 1355 }]),
      log,
    });
    assert.equal(code, 1);
    assert.match(lines.join('\n'), /3001 projetées/);
  });

  test('fails when the billing API refuses the token', async () => {
    const { log } = quietly();
    await assert.rejects(
      run({ env, now: NOV_10, fetch: async () => new Response('Bad credentials', { status: 401 }), log }),
      /API de facturation GitHub : 401/,
    );
  });

  test('passes with a notice, without calling the API, when the token is missing', async () => {
    const calls = [];
    const { lines, log } = quietly();
    const code = await run({ env: { ...env, ACTIONS_BILLING_TOKEN: '' }, now: NOV_10, fetch: billing([], calls), log });
    assert.equal(code, 0);
    assert.equal(calls.length, 0);
    assert.match(lines.join('\n'), /::notice::.*ACTIONS_BILLING_TOKEN/);
  });
});

test('the script, run as the workflow runs it without the secret, exits 0 with a notice', () => {
  const script = fileURLToPath(new URL('./actions-minutes.mjs', import.meta.url));
  const env = { ...process.env, ACTIONS_BILLING_TOKEN: '', GITHUB_REPOSITORY_OWNER: 'owner' };
  delete env.GITHUB_STEP_SUMMARY;
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /::notice::/);
});
