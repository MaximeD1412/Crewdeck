import { renumberingOf } from './tickets.switch.js';

describe('renumberingOf (SOURCE-8)', () => {
  it('maps every held number to its new one', () => {
    expect([...renumberingOf('tickets', [{ from: 12, to: 57 }, { from: 14, to: 12 }], [12, 14])]).toEqual([
      [12, 57],
      [14, 12],
    ]);
    expect(renumberingOf('tickets', [], []).size).toBe(0);
  });

  it('throws for a held row it misses', () => {
    expect(() => renumberingOf('tickets', [{ from: 12, to: 57 }], [12, 14])).toThrow('tickets: the renumbering misses 1 rows');
  });

  it('leaves out a number no row holds: an item the Runner read that the server never held (a closed milestone, an issue not reconciled yet)', () => {
    expect([...renumberingOf('milestones', [{ from: 1, to: 1 }, { from: 7, to: 2 }], [1])]).toEqual([[1, 1]]);
  });

  it('throws for a number given twice, old or new', () => {
    expect(() => renumberingOf('tickets', [{ from: 12, to: 57 }, { from: 12, to: 58 }], [12])).toThrow('renumbered twice');
    expect(() => renumberingOf('milestones', [{ from: 1, to: 3 }, { from: 2, to: 3 }], [1, 2])).toThrow('milestones: a number renumbered twice');
  });
});
