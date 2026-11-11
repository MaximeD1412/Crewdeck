#!/usr/bin/env node
// Throwaway: copies the spike's recordings, scrubbed, into the adapters'
// testdata folders. Run from the repository's root once the scenarios are
// recorded; missing recordings are listed and skipped.
//
//   node docs/spikes/scripts/collect.mjs
//
// For each recording <name>: <name>.jsonl is the Moteur's raw stdout,
// <name>.stdin.jsonl what the driver wrote; a scenario's side channels go to
// <scenario>.permission-tool.jsonl and <scenario>.hook.jsonl. Not part of the Runner.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.SPIKE_ROOT ?? '/tmp/crewdeck-spike';
const here = path.dirname(new URL(import.meta.url).pathname);

// [moteur, recording folder, scenario, recording names, side channels]
const table = [
  ['claude', '01-plain-turn', '01-plain-turn', ['01-plain-turn'], []],
  ['claude', '02-permission-allow', '02-permission-allow', ['02-permission-allow'], ['permission-tool']],
  ['claude', '02-permission-deny', '02-permission-deny', ['02-permission-deny'], ['permission-tool']],
  [
    'claude',
    '02-permission-idle-timeout',
    '02-permission-idle-timeout',
    ['02-permission-idle-timeout'],
    ['permission-tool'],
  ],
  [
    'claude',
    '02-permission-idle-timeout-off',
    '02-permission-idle-timeout-off',
    ['02-permission-idle-timeout-off'],
    ['permission-tool'],
  ],
  ['claude', '03-question', '03-question', ['03-a-updated-input', '03-b-deny-reason'], ['hook']],
  ['claude', '03-question-held', '03-question-held', ['03-c-held-2h'], ['hook']],
  ['claude', '04-interrupt-resume', '04-interrupt-resume', ['04-interrupt', '04-resume'], []],
  [
    'claude',
    '05-runner-restart',
    '05-runner-restart',
    ['05-a-kill-mid-stream', '05-a-resume', '05-b-kill-pending-permission', '05-b-resume'],
    ['permission-tool'],
  ],
  ['claude', '06-limits-usage', '06-limits-usage', ['06-a-usage-subscription', '06-b-limit-reached'], []],
  [
    'claude',
    '07-auth-states',
    '07-auth-states',
    ['07-a-subscription', '07-b-not-signed-in', '07-c-unknown-model'],
    [],
  ],
  ['claude', '08-skills-mounting', '08-skills-mounting', ['08-skills-mounting'], []],
  ['claude', '09-permission-modes', '09-permission-modes', ['09-a-bypass', '09-b-auto', '09-c-auto-outside'], []],
  [
    'codex',
    '06-limits-usage',
    '06-limits-usage',
    ['06-a-quota-exceeded-app-server', '06-b-quota-exceeded-exec'],
    [],
  ],
  [
    'codex',
    '07-auth-states',
    '07-auth-states',
    ['07-a-app-server-not-signed-in', '07-b-exec-not-signed-in', '07-c-app-server-api-key'],
    [],
  ],
];

const missing = [];
for (const [moteur, folder, scenario, names, sides] of table) {
  const src = path.join(root, moteur === 'claude' ? 'rec' : 'rec-codex', folder);
  const dst = path.join('apps/runner/internal/engine', moteur, 'testdata');
  fs.mkdirSync(dst, { recursive: true });
  const scrub = (from, to) => {
    if (!fs.existsSync(from) || !fs.statSync(from).size) return missing.push(`${moteur} ${path.basename(from)}`);
    execFileSync('node', [path.join(here, 'scrub.mjs'), from, to], { stdio: 'inherit' });
  };
  for (const name of names) {
    scrub(path.join(src, `${name}.stdout.jsonl`), path.join(dst, `${name}.jsonl`));
    const stdin = path.join(src, `${name}.stdin.jsonl`);
    if (fs.existsSync(stdin) && fs.statSync(stdin).size) scrub(stdin, path.join(dst, `${name}.stdin.jsonl`));
  }
  for (const side of sides) scrub(path.join(src, `${side}.jsonl`), path.join(dst, `${scenario}.${side}.jsonl`));
}
if (missing.length) console.log(`not recorded yet:\n  ${missing.join('\n  ')}`);
