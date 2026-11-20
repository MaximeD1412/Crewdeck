import { renumberingOf } from './tickets.switch.js';

describe('renumberingOf (SOURCE-8)', () => {
  it('maps every held number to its new one', () => {
    expect([...renumberingOf('tickets', [{ from: 12, to: 57 }, { from: 14, to: 12 }], [12, 14])]).toEqual([
      [12, 57],
      [14, 12],
    ]);
    expect(renumberingOf('tickets', [], []).size).toBe(0);
  });

  it('throws for a held row it misses, and for a number no row holds', () => {
    expect(() => renumberingOf('tickets', [{ from: 12, to: 57 }], [12, 14])).toThrow('misses 1 rows and names 0 unknown ones');
    expect(() => renumberingOf('tickets', [{ from: 12, to: 57 }, { from: 99, to: 58 }], [12])).toThrow('misses 0 rows and names 1 unknown ones');
  });

  it('throws for a number given twice, old or new', () => {
    expect(() => renumberingOf('tickets', [{ from: 12, to: 57 }, { from: 12, to: 58 }], [12])).toThrow('renumbered twice');
    expect(() => renumberingOf('milestones', [{ from: 1, to: 3 }, { from: 2, to: 3 }], [1, 2])).toThrow('milestones: a number renumbered twice');
  });
});
