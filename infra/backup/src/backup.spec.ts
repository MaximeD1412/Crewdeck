/**
 * `bin/backup.sh`, the nightly backup, run for real against a temporary
 * `/opt/crewdeck` with stubs for `docker` and `restic` (testing/bench.ts).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BIN, type Bench, bench, calls, DUMP, index, read, remove, run, temporaryDir } from './testing/bench.js';

const BACKUP = join(BIN, 'backup.sh');
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\n$/;

let temporary: string;
let b: Bench;
let lastSuccess: string;

beforeEach(() => {
  temporary = temporaryDir();
  b = bench(temporary);
  lastSuccess = join(b.root, 'backup/status/last-success');
});

afterEach(() => remove(temporary));

describe('backup.sh: a backup that succeeds', () => {
  it("saves production's pg_dump in a snapshot tagged prod, named crewdeck-prod.dump", () => {
    const result = run(b, BACKUP);

    expect(result.status).toBe(0);
    const backup = calls(b).find((call) => call.startsWith('restic backup '));
    expect(backup).toContain('--tag prod');
    expect(backup).toContain('--stdin-filename crewdeck-prod.dump');
    expect(backup).toContain(`--stdin-from-command -- docker compose -p crewdeck-prod --env-file ${join(b.root, 'prod/.env')} -f ${join(b.root, 'deploy/docker-compose.yml')} exec -T db pg_dump -U crewdeck -Fc crewdeck`);
    expect(read(join(b.state, 'snapshot'))).toBe(DUMP);
  });

  it('reads the repository and its credentials from restic.env', () => {
    run(b, BACKUP);

    expect(calls(b).find((call) => call.startsWith('restic backup '))).toContain(
      '[RESTIC_REPOSITORY=s3:https://s3.example.invalid/crewdeck-backup]',
    );
  });

  it('prunes with the retention, after the backup', () => {
    run(b, BACKUP);

    const forget = calls(b).find((call) => call.startsWith('restic forget '));
    expect(forget).toContain('--tag prod --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune');
    expect(index(b, 'restic forget ')).toBeGreaterThan(index(b, 'restic backup '));
  });

  it('writes the instant of its success, ISO 8601 in UTC, in last-success', () => {
    const before = Date.now();
    run(b, BACKUP);

    const written = read(lastSuccess);
    expect(written).toMatch(ISO_UTC);
    expect(Date.parse(written.trim())).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(Date.parse(written.trim())).toBeLessThanOrEqual(Date.now());
  });
});

describe('backup.sh: a backup that fails', () => {
  const PREVIOUS = '2026-11-09T01:34:12Z\n';

  it.each(['backup', 'forget'])('leaves last-success unchanged and exits non-zero when restic %s fails', (subcommand) => {
    run(b, BACKUP);
    writeFileSync(lastSuccess, PREVIOUS);

    const result = run(b, BACKUP, [], { STUB_RESTIC_FAILS: subcommand });

    expect(result.status).not.toBe(0);
    expect(read(lastSuccess)).toBe(PREVIOUS);
  });

  it('does not prune when the backup failed', () => {
    const result = run(b, BACKUP, [], { STUB_RESTIC_FAILS: 'backup' });

    expect(result.status).not.toBe(0);
    expect(index(b, 'restic forget ')).toBe(-1);
    expect(read(lastSuccess)).toBe('');
  });

  it('fails, without a snapshot, when pg_dump fails', () => {
    const result = run(b, BACKUP, [], { STUB_PG_DUMP_STATUS: '1' });

    expect(result.status).not.toBe(0);
    expect(read(join(b.state, 'snapshot'))).toBe('');
    expect(read(lastSuccess)).toBe('');
  });

  it("refuses to run without production's env file, before calling restic", () => {
    remove(join(b.root, 'prod/.env'));
    const result = run(b, BACKUP);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('prod/.env');
    expect(index(b, 'restic ')).toBe(-1);
  });

  it('refuses to run without restic.env, before calling restic', () => {
    remove(join(b.root, 'backup/restic.env'));

    const result = run(b, BACKUP);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('restic.env');
    expect(index(b, 'restic ')).toBe(-1);
  });
});
