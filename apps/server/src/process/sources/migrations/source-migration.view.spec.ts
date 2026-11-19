import { zSourceMigration } from '@crewdeck/contracts';
import { toSourceMigration } from './source-migration.view.js';

describe('toSourceMigration', () => {
  const row = {
    id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b01',
    projectId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b02',
    group: 'ticket',
    from: 'local',
    to: 'github',
    state: 'switched',
    total: 30,
    copied: 30,
    waitingItems: [{ itemType: 'ticket', number: 12 }],
    errorCode: null,
    attempt: 1,
    createdAt: new Date('2026-11-19T08:00:00.000Z'),
    switchedAt: new Date('2026-11-19T08:05:00.000Z'),
    endedAt: null,
  } as const;

  it('is the contract’s migration, its dates in ISO', () => {
    const migration = toSourceMigration(row);
    expect(zSourceMigration.parse(migration)).toEqual(migration);
    expect(migration).toMatchObject({ createdAt: '2026-11-19T08:00:00.000Z', switchedAt: '2026-11-19T08:05:00.000Z', endedAt: null, waitingItems: [{ itemType: 'ticket', number: 12 }] });
  });

  it('throws on waiting items the server did not write', () => {
    expect(() => toSourceMigration({ ...row, waitingItems: [{ itemType: 'nope' }] })).toThrow();
  });
});
