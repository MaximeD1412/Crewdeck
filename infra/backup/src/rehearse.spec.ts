/**
 * `bin/rehearse.sh <sha>`, the migration rehearsal on the latest backup, run
 * for real with stubs for `docker` and `restic` (testing/bench.ts); then
 * installed where `infra/deploy/bin/deploy.sh` calls it, for a production
 * deploy.
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BIN, type Bench, bench, calls, DEPLOY_BIN, DUMP, IMAGE, index, leftovers, read, remove, run, temporaryDir } from './testing/bench.js';

const REHEARSE = join(BIN, 'rehearse.sh');
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const PREVIOUS = '0f1e2d3c4b5a69788796a5b4c3d2e1f001234567';
const SNAPSHOT = { STUB_SNAPSHOT_TIME: '2026-11-10T01:41:07.123456789+00:00' };

let temporary: string;
let b: Bench;

beforeEach(() => {
  temporary = temporaryDir();
  b = bench(temporary);
  // The snapshot the night's backup left.
  writeFileSync(join(b.state, 'snapshot'), DUMP);
});

afterEach(() => remove(temporary));

describe('rehearse.sh: a rehearsal that succeeds', () => {
  it('restores the latest prod snapshot into a throwaway PostgreSQL 18, then migrates it with the image of <sha>', () => {
    const result = run(b, REHEARSE, [SHA], SNAPSHOT);

    expect(result.status).toBe(0);
    const db = calls(b).find((call) => call.startsWith('docker run ') && call.includes(' postgres:18'));
    expect(db).toBeDefined();
    const name = /--name (\S+)/.exec(db ?? '')?.[1] ?? '';
    expect(name).not.toMatch(/^crewdeck-(prod|staging)/);
    expect(index(b, 'restic dump ')).toBeGreaterThan(index(b, ' postgres:18'));
    expect(calls(b).find((call) => call.startsWith('restic dump '))).toMatch(/--tag prod .*latest \/crewdeck-prod\.dump/);
    expect(read(join(b.state, `restored-${name}`))).toBe(DUMP);
    const migrate = calls(b).find((call) => call.includes(`${IMAGE}:${SHA} migrate`));
    expect(migrate).toContain(`@${name}:5432/crewdeck`);
    expect(index(b, `${IMAGE}:${SHA} migrate`)).toBeGreaterThan(index(b, 'pg_restore'));
  });

  it('runs on a network of its own and removes its containers and network', () => {
    const result = run(b, REHEARSE, [SHA], SNAPSHOT);

    expect(result.status).toBe(0);
    expect(index(b, 'docker network create ')).toBeGreaterThanOrEqual(0);
    expect(calls(b).find((call) => call.includes(' postgres:18'))).not.toContain('crewdeck-prod_default');
    expect(leftovers(b)).toEqual([]);
  });
});

describe('rehearse.sh: a rehearsal that fails', () => {
  it('exits non-zero with « la migration échoue sur la dernière sauvegarde », and leaves nothing behind', () => {
    const result = run(b, REHEARSE, [SHA], { ...SNAPSHOT, STUB_MIGRATE_STATUS: '1' });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('la migration échoue sur la dernière sauvegarde');
    expect(leftovers(b)).toEqual([]);
  });

  it('exits non-zero, before migrating, when the restore fails, and leaves nothing behind', () => {
    const result = run(b, REHEARSE, [SHA], { ...SNAPSHOT, STUB_RESTORE_STATUS: '1' });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('restauration');
    expect(index(b, ' migrate')).toBe(-1);
    expect(leftovers(b)).toEqual([]);
  });

  it('exits non-zero when the repository cannot be read', () => {
    const result = run(b, REHEARSE, [SHA], { ...SNAPSHOT, STUB_RESTIC_FAILS: 'snapshots' });

    expect(result.status).not.toBe(0);
    expect(index(b, 'docker run ')).toBe(-1);
  });

  it('refuses a sha that is not 40 hexadecimal characters', () => {
    const result = run(b, REHEARSE, ['main'], SNAPSHOT);

    expect(result.status).not.toBe(0);
    expect(calls(b)).toEqual([]);
  });
});

describe('rehearse.sh: no backup yet', () => {
  it('prints « aucune sauvegarde : répétition sautée » and exits 0 without starting anything', () => {
    const result = run(b, REHEARSE, [SHA]);

    expect(result.status).toBe(0);
    expect(result.output).toContain('aucune sauvegarde : répétition sautée');
    expect(index(b, 'docker ')).toBe(-1);
  });
});

describe('deploy.sh production, with rehearse.sh installed', () => {
  /** `/opt/crewdeck` with production deployed at `PREVIOUS`, and rehearse.sh where install.sh puts it. */
  function production(): void {
    for (const dir of ['deploy/bin', 'prod']) mkdirSync(join(b.root, dir), { recursive: true });
    writeFileSync(join(b.root, 'deploy/docker-compose.yml'), 'services: {}\n');
    writeFileSync(join(b.root, 'deploy/ghcr.env'), 'GHCR_USERNAME=crewdeck-deploy\nGHCR_TOKEN=fake\n');
    writeFileSync(join(b.root, 'prod/.env'), `CREWDECK_ENV=production\nCREWDECK_SHA=${PREVIOUS}\n`);
    writeFileSync(join(b.root, 'prod/current-sha'), `${PREVIOUS}\n`);
    copyFileSync(REHEARSE, join(b.root, 'deploy/bin/rehearse.sh'));
  }

  const deploy = (extra: NodeJS.ProcessEnv) =>
    run(b, join(DEPLOY_BIN, 'deploy.sh'), ['production', SHA], {
      DEPLOY_LOCK_DIR: join(temporary, 'lock'),
      HEALTH_TIMEOUT: '1',
      HEALTH_INTERVAL: '0.1',
      ...extra,
    });

  it("stops before migrating production when the migration fails on the latest backup, and leaves no container", () => {
    production();
    const result = deploy({ ...SNAPSHOT, STUB_MIGRATE_STATUS: '1' });

    expect(result.status).toBe(1);
    expect(result.output).toContain('la migration échoue sur la dernière sauvegarde');
    expect(index(b, 'run --rm server migrate')).toBe(-1);
    expect(index(b, ' up -d')).toBe(-1);
    expect(read(join(b.root, 'prod/.env'))).toContain(`CREWDECK_SHA=${PREVIOUS}`);
    expect(leftovers(b)).toEqual([]);
  });

  it('migrates production once the rehearsal passed', () => {
    production();
    const result = deploy(SNAPSHOT);

    expect(result.status).toBe(0);
    expect(index(b, 'run --rm server migrate')).toBeGreaterThan(index(b, `${IMAGE}:${SHA} migrate`));
    expect(leftovers(b)).toEqual([]);
  });
});
