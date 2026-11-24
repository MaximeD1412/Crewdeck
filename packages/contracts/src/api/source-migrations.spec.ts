import {
  eventPayloadSchema,
  RESOURCES,
  SOURCE_MIGRATION_CODE_TOKEN_PERMISSIONS,
  STATE_SLICES,
  zMigrateSourceInput,
  zPickSourceFolderInput,
  zSourceMigration, zSourceMigrationPage, zSourceMigrationQuery } from '../index.js';

const MIGRATION = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d01',
  projectId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d02',
  group: 'ticket',
  from: 'local',
  to: 'github',
  state: 'draining',
  total: 0,
  copied: 0,
  waitingItems: [{ itemType: 'ticket', number: 12 }, { itemType: 'ticket', number: 14 }],
  errorCode: null,
  attempt: 1,
  createdAt: '2026-11-11T09:00:00.000Z',
  switchedAt: null,
  endedAt: null,
};

describe('zSourceMigration', () => {
  it('is the payload of source-migration.upserted, an item of its list and of the sourceMigrations slice', () => {
    expect(RESOURCES).toContain('source-migration');
    expect(eventPayloadSchema('source-migration.upserted')?.parse(MIGRATION)).toEqual(MIGRATION);
    expect(zSourceMigrationPage.parse({ items: [MIGRATION], nextCursor: null }).items).toEqual([MIGRATION]);
    expect(STATE_SLICES.sourceMigrations.parse([MIGRATION])).toEqual([MIGRATION]);
  });

  it('keeps no fingerprint nor free text: what was moved stays on the server', () => {
    expect(Object.keys(zSourceMigration.parse({ ...MIGRATION, fingerprints: [{ key: 'ticket:12' }] }))).not.toContain('fingerprints');
  });

  it('moves the Tickets or the code only, between Local and GitHub, through the six states', () => {
    expect(zSourceMigration.safeParse({ ...MIGRATION, group: 'idea' }).success).toBe(false);
    expect(zSourceMigration.safeParse({ ...MIGRATION, to: 'gitlab' }).success).toBe(false);
    expect(zSourceMigration.safeParse({ ...MIGRATION, state: 'paused' }).success).toBe(false);
    expect(zSourceMigration.parse({ ...MIGRATION, state: 'failed', errorCode: 'github.unavailable' }).errorCode).toBe('github.unavailable');
  });

  it('is asked with a Source and the seq confirmed on, listed by state 50 per page', () => {
    expect(zMigrateSourceInput.parse({ to: 'github', seq: '42' })).toEqual({ to: 'github', seq: 42 });
    expect(zMigrateSourceInput.safeParse({ to: 'github' }).success).toBe(false);
    expect(zSourceMigrationQuery.parse({ state: 'done' })).toEqual({ state: 'done', limit: 50 });
    expect(zSourceMigrationQuery.safeParse({ state: 'paused' }).success).toBe(false);
  });

  it('picks the new place when the Projet has none there: a repository, or the folder picked beforehand (SOURCE-9)', () => {
    const repositoryId = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d03';
    expect(zMigrateSourceInput.parse({ to: 'github', target: { repositoryId }, seq: '42' }).target).toEqual({ repositoryId });
    expect(zMigrateSourceInput.parse({ to: 'local', target: { folder: true }, seq: '42' }).target).toEqual({ folder: true });
    expect(zMigrateSourceInput.safeParse({ to: 'local', target: { folder: false }, seq: '42' }).success).toBe(false);
    expect(zMigrateSourceInput.safeParse({ to: 'local', target: { folder: '/home/pilote/projets' }, seq: '42' }).success).toBe(false);
    expect(zMigrateSourceInput.safeParse({ to: 'github', target: { repositoryId, folder: true }, seq: '42' }).success).toBe(false);
  });

  it('sends the picked folder sealed only (SOURCE-9)', () => {
    const sealed = { key: 'A'.repeat(80), ciphertext: 'B'.repeat(43) };
    expect(zPickSourceFolderInput.parse({ folderSealed: sealed, vaultKeyVersion: 1 }).folderSealed).toEqual(sealed);
    expect(zPickSourceFolderInput.safeParse({ folderSealed: { path: '/home/pilote/projets' }, vaultKeyVersion: 1 }).success).toBe(false);
  });

  it('gives the code’s token the contents, the PRs and the workflows, never the issues nor the administration (SOURCE-9)', () => {
    expect(SOURCE_MIGRATION_CODE_TOKEN_PERMISSIONS).toEqual({ contents: 'write', pull_requests: 'write', workflows: 'write' });
  });
});
