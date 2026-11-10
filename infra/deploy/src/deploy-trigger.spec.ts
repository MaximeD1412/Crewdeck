/**
 * `bin/deploy-trigger`, the forced command of each deploy key, run for real
 * from a temporary copy of `bin/` whose `deploy.sh` is a stub recording its
 * arguments: what a key refuses never reaches it.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const TRIGGER = resolve(import.meta.dirname, '../bin/deploy-trigger');
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

let bin: string;
let calls: string;

beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), 'crewdeck-deploy-trigger-'));
  calls = join(bin, 'deploy.calls');
  copyFileSync(TRIGGER, join(bin, 'deploy-trigger'));
  chmodSync(join(bin, 'deploy-trigger'), 0o755);
  writeFileSync(join(bin, 'deploy.sh'), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${calls}"\nexit "\${STUB_STATUS:-0}"\n`);
  chmodSync(join(bin, 'deploy.sh'), 0o755);
});

afterEach(() => rmSync(bin, { recursive: true, force: true }));

function trigger(args: string[], command: string | undefined, extra: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env.SSH_ORIGINAL_COMMAND;
  if (command !== undefined) env.SSH_ORIGINAL_COMMAND = command;
  const result = spawnSync(join(bin, 'deploy-trigger'), args, { encoding: 'utf8', env });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    deployed: existsSync(calls) ? readFileSync(calls, 'utf8') : null,
  };
}

describe('deploy-trigger: what a key refuses', () => {
  function refused(args: string[], command: string | undefined): void {
    const result = trigger(args, command);
    expect(result.status).toBe(1);
    expect(result.output).toContain('commande refusée');
    expect(result.deployed).toBeNull();
  }

  it('refuses production under the staging key, and staging under the production key', () => {
    refused(['staging'], `deploy production ${SHA}`);
    refused(['production'], `deploy staging ${SHA}`);
  });

  it.each([
    ['short', SHA.slice(0, 7)],
    ['39 characters', SHA.slice(0, 39)],
    ['41 characters', `${SHA}0`],
    ['uppercase', SHA.toUpperCase()],
    ['a branch', 'develop'],
  ])('refuses a sha that is %s', (_case, sha) => {
    refused(['staging'], `deploy staging ${sha}`);
  });

  it.each([
    ['an extra argument', `deploy staging ${SHA} --force`],
    ['a `;` injection', `deploy staging ${SHA}; rm -rf /`],
    ['a `;` injection without space', `deploy staging ${SHA};id`],
    ['a second line', `deploy staging ${SHA}\nid`],
    ['a command substitution', `deploy staging $(id)`],
    ['two spaces', `deploy  staging ${SHA}`],
    ['another command', 'ls'],
    ['an empty command', ''],
  ])('refuses %s', (_case, command) => {
    refused(['staging'], command);
  });

  it('refuses a session without a command (an interactive login)', () => {
    refused(['staging'], undefined);
  });

  it('refuses an unknown or missing key environment', () => {
    refused(['prod'], `deploy prod ${SHA}`);
    refused([], `deploy staging ${SHA}`);
    refused(['staging', 'production'], `deploy staging ${SHA}`);
  });
});

describe('deploy-trigger: what a key accepts', () => {
  it.each(['staging', 'production'])('runs deploy.sh <env> <sha> under the %s key', (env) => {
    const result = trigger([env], `deploy ${env} ${SHA}`);

    expect(result.status).toBe(0);
    expect(result.deployed).toBe(`${env} ${SHA}\n`);
  });

  it("returns deploy.sh's exit code, so the workflow is red when the deploy is", () => {
    const result = trigger(['staging'], `deploy staging ${SHA}`, { STUB_STATUS: '1' });

    expect(result.status).toBe(1);
    expect(result.deployed).toBe(`staging ${SHA}\n`);
  });
});
