/**
 * `bin/install.sh`, run for real against a temporary `/opt/crewdeck`
 * (`CREWDECK_ROOT`) and unit directory (`UNIT_DIR`), with stubs for `id`
 * (root, and the user `deploy`), `chown`, `systemctl` and `restic`
 * (testing/bench.ts). The real installation is run once on the VPS (mep.json).
 */
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BIN, type Bench, bench, calls, index, remove, run, temporaryDir } from './testing/bench.js';

const INSTALL = join(BIN, 'install.sh');

let temporary: string;
let b: Bench;
let units: string;

beforeEach(() => {
  temporary = temporaryDir();
  b = bench(temporary);
  units = join(temporary, 'systemd');
  mkdirSync(units);
  mkdirSync(join(b.root, 'deploy/bin'), { recursive: true });
  const stubs = join(temporary, 'stubs');
  for (const [name, body] of Object.entries({
    id: '[ "$1" = -u ] && { echo "${STUB_UID:-0}"; exit 0; }\n[ "$1" = deploy ] && [ -z "${STUB_NO_DEPLOY-}" ] && exit 0\nexit 1',
    chown: 'exit 0',
    systemctl: 'exit 0',
  })) {
    writeFileSync(join(stubs, name), `#!/usr/bin/env bash\nprintf '${name} %s\\n' "$*" >> "$STUB_LOG"\n${body}\n`);
    chmodSync(join(stubs, name), 0o755);
  }
});

afterEach(() => remove(temporary));

const install = (extra: NodeJS.ProcessEnv = {}) => run(b, INSTALL, [], { UNIT_DIR: units, ...extra });
const mode = (path: string): string => (statSync(path).mode & 0o777).toString(8);

describe('install.sh', () => {
  it('installs backup.sh, rehearse.sh where deploy.sh calls it, and the units, then enables the timer', () => {
    const result = install();

    expect(result.status).toBe(0);
    expect(readFileSync(join(b.root, 'backup/bin/backup.sh'), 'utf8')).toBe(readFileSync(join(BIN, 'backup.sh'), 'utf8'));
    expect(mode(join(b.root, 'backup/bin/backup.sh'))).toBe('755');
    expect(readFileSync(join(b.root, 'deploy/bin/rehearse.sh'), 'utf8')).toBe(readFileSync(join(BIN, 'rehearse.sh'), 'utf8'));
    expect(mode(join(b.root, 'deploy/bin/rehearse.sh'))).toBe('755');
    expect(mode(join(units, 'crewdeck-backup.service'))).toBe('644');
    expect(mode(join(units, 'crewdeck-backup.timer'))).toBe('644');
    expect(index(b, 'systemctl daemon-reload')).toBeGreaterThanOrEqual(0);
    expect(index(b, 'systemctl enable --now crewdeck-backup.timer')).toBeGreaterThan(index(b, 'systemctl daemon-reload'));
  });

  it('creates the status directory the server reads, readable by its container', () => {
    install();

    expect(mode(join(b.root, 'backup/status'))).toBe('755');
  });

  it('gives restic.env and the password file to deploy, mode 600: the rehearsal runs as deploy', () => {
    install();

    for (const file of ['backup/restic.env', 'backup/restic-password']) {
      expect(mode(join(b.root, file))).toBe('600');
      expect(calls(b)).toContain(`chown deploy:deploy ${join(b.root, file)}`);
    }
  });

  it('is idempotent', () => {
    expect(install().status).toBe(0);
    expect(install().status).toBe(0);
    expect(mode(join(b.root, 'backup/bin/backup.sh'))).toBe('755');
  });

  it.each([
    ['not run as root', { STUB_UID: '1000' }, 'root'],
    ['restic is older than 0.17', { STUB_RESTIC_VERSION: '0.16.4' }, '0.17'],
    ['the user deploy does not exist', { STUB_NO_DEPLOY: '1' }, 'install-access.sh'],
  ])('refuses, touching nothing, when %s', (_, extra, message) => {
    const result = install(extra);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(message);
    expect(index(b, 'systemctl ')).toBe(-1);
  });

  it('refuses without restic.env, pointing to its template', () => {
    remove(join(b.root, 'backup/restic.env'));
    const result = install();

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('restic.env.example');
    expect(index(b, 'systemctl ')).toBe(-1);
  });
});
