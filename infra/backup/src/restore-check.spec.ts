/**
 * `bin/restore-check.sh --env <file>`, the founder's monthly restore check,
 * run for real with stubs for `docker` and `restic` (testing/bench.ts).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BIN, type Bench, bench, calls, DUMP, index, leftovers, read, remove, run, temporaryDir } from './testing/bench.js';

const CHECK = join(BIN, 'restore-check.sh');
const HOUR = 3_600_000;

let temporary: string;
let b: Bench;
let envFile: string;

/** A snapshot taken `hours` ago, in restic's format (nanoseconds, an offset). */
const takenAgo = (hours: number): { taken: string; env: NodeJS.ProcessEnv } => {
  const taken = new Date(Math.floor((Date.now() - hours * HOUR) / 1000) * 1000);
  return { taken: taken.toISOString().replace('.000Z', 'Z'), env: { STUB_SNAPSHOT_TIME: taken.toISOString().replace('.000Z', '.123456789+00:00') } };
};

beforeEach(() => {
  temporary = temporaryDir();
  // The founder's machine: no restic.env under /opt/crewdeck, a file of their own.
  b = bench(temporary, { resticEnv: false });
  envFile = join(temporary, 'crewdeck-restic.env');
  writeFileSync(
    envFile,
    `RESTIC_REPOSITORY=s3:https://s3.example.invalid/crewdeck-backup\nRESTIC_PASSWORD_FILE=${join(b.root, 'backup/restic-password')}\nAWS_ACCESS_KEY_ID=fake\nAWS_SECRET_ACCESS_KEY=fake\n`,
  );
  writeFileSync(join(b.state, 'snapshot'), DUMP);
});

afterEach(() => remove(temporary));

describe('restore-check.sh: a recent backup', () => {
  it('restores the latest snapshot into a local throwaway PostgreSQL 18 and prints its date and migrations', () => {
    const { taken, env } = takenAgo(2);
    const result = run(b, CHECK, ['--env', envFile], { ...env, STUB_MIGRATIONS: '7' });

    expect(result.status).toBe(0);
    expect(result.output).toContain(taken);
    expect(result.output).toContain('7 migrations');
    const db = calls(b).find((call) => call.startsWith('docker run ') && call.includes(' postgres:18'));
    const name = /--name (\S+)/.exec(db ?? '')?.[1] ?? '';
    expect(read(join(b.state, `restored-${name}`))).toBe(DUMP);
    expect(calls(b).find((call) => call.includes(' psql '))).toContain('SELECT count(*) FROM _prisma_migrations');
    expect(db).not.toMatch(/ -p | --publish /);
  });

  it('reads the repository from the given env file', () => {
    run(b, CHECK, ['--env', envFile], takenAgo(2).env);

    expect(calls(b).find((call) => call.startsWith('restic dump '))).toContain(
      '[RESTIC_REPOSITORY=s3:https://s3.example.invalid/crewdeck-backup]',
    );
  });

  it('restores the very snapshot whose date it prints', () => {
    run(b, CHECK, ['--env', envFile], takenAgo(2).env);

    expect(calls(b).find((call) => call.startsWith('restic dump '))).toContain('70d3d6c0 /crewdeck-prod.dump');
  });

  it('removes its container and its volume, the restored copy of production', () => {
    run(b, CHECK, ['--env', envFile], takenAgo(2).env);

    expect(leftovers(b)).toEqual([]);
  });
});

describe('restore-check.sh: a check that fails', () => {
  it('exits non-zero when the latest snapshot is older than 26 h, after restoring it', () => {
    const { taken, env } = takenAgo(27);
    const result = run(b, CHECK, ['--env', envFile], env);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(taken);
    expect(result.output).toContain('26 h');
    expect(leftovers(b)).toEqual([]);
  });

  it('exits non-zero when the restore fails, and removes its container', () => {
    const result = run(b, CHECK, ['--env', envFile], { ...takenAgo(2).env, STUB_RESTORE_STATUS: '1' });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('restauration');
    expect(index(b, ' psql ')).toBe(-1);
    expect(leftovers(b)).toEqual([]);
  });

  it('exits non-zero when the repository has no snapshot', () => {
    const result = run(b, CHECK, ['--env', envFile]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('aucune sauvegarde');
    expect(index(b, 'docker ')).toBe(-1);
  });

  it('requires --env and a readable file', () => {
    expect(run(b, CHECK).status).not.toBe(0);
    expect(run(b, CHECK, ['--env', join(temporary, 'absent.env')]).output).toContain('absent.env');
    expect(index(b, 'restic ')).toBe(-1);
  });
});
