import { PROCESS_CREWDECK } from '@crewdeck/contracts';
import { heldByMigration } from './draining.js';

/** A transaction whose migrations holding work are those of `groups`. */
const txWith = (groups: ('ticket' | 'code')[]) => {
  const findMany = vi.fn(() => Promise.resolve(groups.map((group) => ({ group }))));
  return { tx: { sourceMigration: { findMany } } as never, findMany };
};

describe('heldByMigration', () => {
  it('holds a Phase that reads or writes the group being migrated', async () => {
    expect(await heldByMigration(txWith(['ticket']).tx, 'p', PROCESS_CREWDECK, 'ph-dev')).toBe(true);
    expect(await heldByMigration(txWith(['code']).tx, 'p', PROCESS_CREWDECK, 'ph-dev')).toBe(true);
  });

  it('never holds an Idée’s Phase, nor any Phase while nothing is migrated', async () => {
    expect(await heldByMigration(txWith(['ticket']).tx, 'p', PROCESS_CREWDECK, 'ph-idee')).toBe(false);
    expect(await heldByMigration(txWith([]).tx, 'p', PROCESS_CREWDECK, 'ph-dev')).toBe(false);
  });

  it('reads only the migrations draining, copying or verifying: once switched, the new Source wins', async () => {
    const { tx, findMany } = txWith([]);
    await heldByMigration(tx, 'p', PROCESS_CREWDECK, 'ph-dev');
    expect(findMany).toHaveBeenCalledWith({ where: { projectId: 'p', state: { in: ['draining', 'copying', 'verifying'] } }, select: { group: true } });
  });
});
