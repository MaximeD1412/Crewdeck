/**
 * `bin/install-access.sh --print`: the authorized_keys it would write, from
 * public keys made by ssh-keygen for the test. The installation itself needs
 * root and is run once by INFRA-12; what decides what a key may do is this
 * file.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dirname, '../bin/install-access.sh');
const TRIGGER = '/opt/crewdeck/deploy/bin/deploy-trigger';

let dir: string;
let staging: string;
let production: string;

const key = (name: string): string => {
  const path = join(dir, name);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `${name}@test`, '-f', path]);
  return `${path}.pub`;
};

const bare = (pub: string): string => readFileSync(pub, 'utf8').trim().split(' ').slice(0, 2).join(' ');

function install(args: string[]) {
  const result = spawnSync(SCRIPT, args, { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'crewdeck-install-access-'));
  staging = key('staging');
  production = key('production');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('install-access.sh --print', () => {
  it('forces each key on deploy-trigger for its own environment, with restrict', () => {
    const result = install(['--staging-key', staging, '--production-key', production, '--print']);

    expect(result.status).toBe(0);
    const lines = result.stdout.split('\n').filter((line) => line && !line.startsWith('#'));
    expect(lines).toEqual([
      `command="${TRIGGER} staging",restrict ${bare(staging)} crewdeck-deploy-staging`,
      `command="${TRIGGER} production",restrict ${bare(production)} crewdeck-deploy-production`,
    ]);
  });

  it('writes the same file on every run', () => {
    const args = ['--staging-key', staging, '--production-key', production, '--print'];
    expect(install(args).stdout).toBe(install(args).stdout);
  });

  it('refuses the same key for both environments', () => {
    const result = install(['--staging-key', staging, '--production-key', staging, '--print']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('une clé par environnement');
  });

  it.each([
    ['options before the key', (pub: string) => `no-pty ${pub}`],
    ['a second line', (pub: string) => `${pub}\n${pub}`],
    ['no key', () => 'not a key'],
  ])('refuses a key file with %s, which would open a shell or nothing', (_case, content) => {
    const file = join(dir, 'bad.pub');
    writeFileSync(file, content(readFileSync(staging, 'utf8').trim()));
    const result = install(['--staging-key', file, '--production-key', production, '--print']);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
  });

  it('requires both keys', () => {
    expect(install(['--staging-key', staging, '--print']).status).toBe(1);
    expect(install(['--production-key', production, '--print']).status).toBe(1);
  });
});
