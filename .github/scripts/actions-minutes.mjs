// The Actions minutes of the month for the account, against its quota (ADR
// 0009, « CI »; risk OPS-6). Run daily by .github/workflows/actions-minutes.yml:
// exits 1 at 80 % of the quota, or when the month's projection exceeds it, and
// GitHub's email of the failed workflow brings the news. Agents open many PRs:
// the minutes are watched, not discovered on the bill.
//
// The usage covers every repository of the account, public ones included:
// the figure can only be above what is billed.
//
// Model: MaximeD1412/personal-os, .github/scripts/actions-minutes.mjs.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ALERT_RATIO = 0.8;

/** The minutes included in GitHub Pro, without the variable ACTIONS_MINUTES_QUOTA. */
export const DEFAULT_QUOTA = 3000;

/**
 * The quota read from ACTIONS_MINUTES_QUOTA. Missing, it is GitHub Pro's; a
 * value it cannot read fails, rather than silently watch another threshold
 * than the one set.
 */
export function quotaOf(value) {
  if (value === undefined || value.trim() === '') return DEFAULT_QUOTA;
  const quota = Number(value.trim());
  if (!/^\d+$/.test(value.trim()) || quota <= 0) {
    throw new Error(
      `Variable ACTIONS_MINUTES_QUOTA illisible (« ${value} ») : un nombre entier de minutes, par exemple 3000.`,
    );
  }
  return quota;
}

/** The Actions minutes in the lines of GET /users/{owner}/settings/billing/usage. */
export function minutesOf(usageItems) {
  return usageItems
    .filter((item) => item.product?.toLowerCase() === 'actions' && item.unitType?.toLowerCase() === 'minutes')
    .reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * The month's minutes against the quota. The projection keeps the month's
 * pace: `used / elapsed days × days in month`, the current day counted as
 * elapsed (the guard runs after the nightly, which is most of a day's
 * minutes). `failure` is null, or why the guard fails.
 */
export function usage(used, quota, now) {
  const elapsedDays = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const projection = Math.round((used / elapsedDays) * daysInMonth);
  let failure = null;
  if (used >= ALERT_RATIO * quota) failure = '80 % du quota atteint';
  else if (projection > quota) failure = 'projection au-delà du quota';
  return { used, quota, projection, failure };
}

/**
 * One run of the guard, its exit code returned. `env` is the workflow's:
 * ACTIONS_BILLING_TOKEN (fine-grained token of the account, « Plan » read),
 * ACTIONS_MINUTES_QUOTA, GITHUB_REPOSITORY_OWNER, GITHUB_STEP_SUMMARY.
 */
export async function run({ env, now = new Date(), fetch = globalThis.fetch, log = console.log }) {
  const token = env.ACTIONS_BILLING_TOKEN;
  if (!token) {
    log(
      '::notice::Secret ACTIONS_BILLING_TOKEN absent : minutes Actions non vérifiées. Le renseigner dans Settings > Secrets and variables > Actions (jeton fin du compte, « Plan » en lecture).',
    );
    return 0;
  }
  const quota = quotaOf(env.ACTIONS_MINUTES_QUOTA);
  const url = `https://api.github.com/users/${env.GITHUB_REPOSITORY_OWNER}/settings/billing/usage?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`API de facturation GitHub : ${response.status} ${await response.text()}`);
  }
  const { usageItems = [] } = await response.json();

  const report = usage(minutesOf(usageItems), quota, now);
  const line = `Minutes Actions ce mois : ${Math.round(report.used)} / ${quota} (${Math.round((report.used / quota) * 100)} %, échec à ${ALERT_RATIO * 100} %), ${report.projection} projetées à la fin du mois`;
  log(line);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
  if (report.failure) {
    log(`::error::${report.failure}. ${line}. Réduire les exécutions (agents, PR), ou vérifier que le budget de dépassement du compte couvre la différence.`);
    return 1;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await run({ env: process.env });
}
