import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zHello, zMigrationCopy, zMigrationFailed, zMigrationFinish, zMigrationProgress, zMigrationSwitch, zRunnerToServer, zServerToRunner } from '../index.js';

const FIXTURES = join(import.meta.dirname, '../../fixtures/runner');
const fixture = <T = Record<string, unknown>>(type: string): T => JSON.parse(readFileSync(join(FIXTURES, `${type}.json`), 'utf8')) as T;

describe('the messages of a migration of Source', () => {
  it('sends copy and finish to the Runner, and takes progress, switch, finished and failed from it', () => {
    for (const type of ['migration.copy', 'migration.finish']) expect(zServerToRunner.parse(fixture(type))).toMatchObject({ type });
    for (const type of ['migration.progress', 'migration.switch', 'migration.finished', 'migration.failed']) expect(zRunnerToServer.parse(fixture(type))).toMatchObject({ type });
    expect(zRunnerToServer.safeParse(fixture('migration.copy')).success).toBe(false);
  });

  it('copies one group between the two Sources, the repository given as owner and name, or absent', () => {
    const copy = fixture('migration.copy');
    expect(zMigrationCopy.parse(copy).repository).toEqual({ owner: 'octo-fixture', name: 'fixture-app' });
    const withoutRepository: Record<string, unknown> = { ...copy };
    delete withoutRepository['repository'];
    expect(zMigrationCopy.parse(withoutRepository).repository).toBeUndefined();
    expect(zMigrationCopy.safeParse({ ...copy, group: 'idea' }).success).toBe(false);
    expect(zMigrationCopy.safeParse({ ...copy, to: 'gitlab' }).success).toBe(false);
  });

  it('counts the copy, then its verification, never another state', () => {
    expect(zMigrationProgress.parse(fixture('migration.progress'))).toMatchObject({ total: 30, copied: 12, state: 'copying' });
    expect(zMigrationProgress.safeParse({ ...fixture('migration.progress'), state: 'switched' }).success).toBe(false);
    expect(zMigrationProgress.safeParse({ ...fixture('migration.progress'), copied: -1 }).success).toBe(false);
  });

  it('carries content-free fingerprints: a key, a state, a sha-256, nothing else', () => {
    const [fingerprint] = zMigrationSwitch.parse(fixture('migration.switch')).fingerprints;
    expect(Object.keys(fingerprint ?? {}).sort()).toEqual(['contentHash', 'key', 'state']);
    const switched = fixture<{ fingerprints: Record<string, unknown>[] }>('migration.switch');
    expect(zMigrationSwitch.safeParse({ ...switched, fingerprints: [{ ...fingerprint, title: 'Connexion' }] }).success).toBe(false);
    expect(zMigrationSwitch.safeParse({ ...switched, fingerprints: [{ ...fingerprint, contentHash: 'abc' }] }).success).toBe(false);
    expect(zMigrationFinish.parse(fixture('migration.finish')).fingerprints).toHaveLength(2);
  });

  it('fails at the copy or at the finish, with an error code', () => {
    expect(zMigrationFailed.parse(fixture('migration.failed'))).toMatchObject({ stage: 'copy', code: 'github.unavailable' });
    expect(zMigrationFailed.safeParse({ ...fixture('migration.failed'), stage: 'switch' }).success).toBe(false);
    expect(zMigrationFailed.safeParse({ ...fixture('migration.failed'), code: 'GitHub en panne' }).success).toBe(false);
  });

  it('lets a hello name the groups its Runner can migrate, or leave them out', () => {
    expect(zHello.parse(fixture('hello')).migrations).toBeUndefined();
    expect(zHello.parse({ ...fixture('hello'), migrations: ['ticket', 'code'] }).migrations).toEqual(['ticket', 'code']);
    expect(zHello.safeParse({ ...fixture('hello'), migrations: ['idea'] }).success).toBe(false);
  });
});
