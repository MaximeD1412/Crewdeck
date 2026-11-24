import { codeChangesPlan } from './code.switch.js';

describe('codeChangesPlan (SOURCE-9)', () => {
  it('renumbers every open or draft change of code, and removes the merged and closed ones, which the copy leaves behind', () => {
    const plan = codeChangesPlan(
      [
        { number: 1, state: 'open' },
        { number: 2, state: 'draft' },
        { number: 3, state: 'merged' },
        { number: 4, state: 'closed' },
      ],
      [
        { from: 1, to: 7 },
        { from: 2, to: 8 },
      ],
    );
    expect([...plan.moves]).toEqual([
      [1, 7],
      [2, 8],
    ]);
    expect(plan.removed).toEqual([3, 4]);
  });

  it('throws for an open change the renumbering misses, or a merged one it names', () => {
    expect(() => codeChangesPlan([{ number: 1, state: 'open' }, { number: 2, state: 'open' }], [{ from: 1, to: 7 }])).toThrow('changes of code: the renumbering misses 1 rows and names 0 unknown ones');
    expect(() => codeChangesPlan([{ number: 3, state: 'merged' }], [{ from: 3, to: 9 }])).toThrow('misses 0 rows and names 1 unknown ones');
  });

  it('moves nothing for a Projet without changes of code', () => {
    const plan = codeChangesPlan([], []);
    expect(plan.moves.size).toBe(0);
    expect(plan.removed).toEqual([]);
  });
});
