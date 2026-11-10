/**
 * `.github/scripts/backup-watch.mjs <health.json>`, the script of
 * `.github/workflows/backup-watch.yml`, run for real on a fake response of
 * production's `/api/health` (what the workflow's curl wrote).
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { remove, temporaryDir } from './testing/bench.js';

const WATCH = resolve(import.meta.dirname, '../../../.github/scripts/backup-watch.mjs');
const HOUR = 3_600_000;

let temporary: string;

beforeEach(() => {
  temporary = temporaryDir();
});

afterEach(() => remove(temporary));

function watch(response: unknown) {
  const file = join(temporary, 'health.json');
  writeFileSync(file, typeof response === 'string' ? response : JSON.stringify(response));
  const result = spawnSync(process.execPath, [WATCH, file], { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const health = (backup: unknown) => ({ status: 'ok', commit: 'abc123', db: 'ok', backup });
const hoursAgo = (hours: number): string => new Date(Date.now() - hours * HOUR).toISOString();

describe('backup-watch.mjs', () => {
  it('passes when the last success is 2 h old', () => {
    const result = watch(health({ lastSuccessAt: hoursAgo(2) }));

    expect(result.status).toBe(0);
    expect(result.output).toContain('il y a 2 h');
  });

  it('fails, with an error annotation, when the last success is 27 h old', () => {
    const lastSuccessAt = hoursAgo(27);
    const result = watch(health({ lastSuccessAt }));

    expect(result.status).toBe(1);
    expect(result.output).toContain('::error');
    expect(result.output).toContain(lastSuccessAt);
    expect(result.output).toContain('27 h');
  });

  it('fails when no backup has succeeded yet', () => {
    const result = watch(health({ lastSuccessAt: null }));

    expect(result.status).toBe(1);
    expect(result.output).toContain('aucune sauvegarde réussie');
  });

  it('fails when production does not report its backup', () => {
    const result = watch({ status: 'ok', commit: 'abc123', db: 'ok' });

    expect(result.status).toBe(1);
    expect(result.output).toContain('BACKUP_STATUS_FILE');
  });

  it('fails on a response that is not the health', () => {
    const result = watch('<html>502 Bad Gateway</html>');

    expect(result.status).toBe(1);
    expect(result.output).toContain('::error');
  });
});
