import { PROCESS_CREWDECK, type ProcessDefinition } from '@crewdeck/contracts';
import { afterChanges, countTaken, withExtraPass } from './loop-backs.js';

const REVIEW_TO_CODE = { from: 'st-review', to: 'st-code', max: 3 };
const without = (stepId: string): ProcessDefinition => ({ ...PROCESS_CREWDECK, loopBacks: PROCESS_CREWDECK.loopBacks.filter((loopBack) => loopBack.from !== stepId) });

describe('afterChanges', () => {
  it('takes the Retour the Étape leaves while it was taken fewer times than its maximum', () => {
    expect(afterChanges(PROCESS_CREWDECK, [], 'st-review')).toEqual({ move: 'take', loopBack: REVIEW_TO_CODE, taken: 0 });
    expect(afterChanges(PROCESS_CREWDECK, [{ from: 'st-review', to: 'st-code', taken: 2, extra: 0 }], 'st-review')).toEqual({ move: 'take', loopBack: REVIEW_TO_CODE, taken: 2 });
  });

  it('stops the item once the Retour was taken max times: the fourth « changements » of a maximum of 3', () => {
    expect(afterChanges(PROCESS_CREWDECK, [{ from: 'st-review', to: 'st-code', taken: 3, extra: 0 }], 'st-review')).toEqual({ move: 'exhausted', loopBack: REVIEW_TO_CODE, taken: 3 });
  });

  it('counts each pass the Pilote allowed beyond the maximum', () => {
    expect(afterChanges(PROCESS_CREWDECK, [{ from: 'st-review', to: 'st-code', taken: 3, extra: 1 }], 'st-review')).toMatchObject({ move: 'take', taken: 3 });
    expect(afterChanges(PROCESS_CREWDECK, [{ from: 'st-review', to: 'st-code', taken: 4, extra: 1 }], 'st-review')).toMatchObject({ move: 'exhausted', taken: 4 });
  });

  it('counts each Retour on its own: the Revue visuelle’s is not the Review’s', () => {
    expect(afterChanges(PROCESS_CREWDECK, [{ from: 'st-review', to: 'st-code', taken: 3, extra: 0 }], 'st-rv')).toEqual({
      move: 'take',
      loopBack: { from: 'st-rv', to: 'st-code', max: 3 },
      taken: 0,
    });
  });

  it('stops the item without a Retour to take when none leaves an agent that judges, and refuses it of a gate', () => {
    expect(afterChanges(without('st-review'), [], 'st-review')).toEqual({ move: 'no-loop-back' });
    expect(afterChanges(without('st-rv'), [], 'st-rv')).toEqual({ move: 'refused' });
    expect(afterChanges(without('st-ap-prd'), [], 'st-ap-prd')).toEqual({ move: 'refused' });
  });
});

describe('countTaken and withExtraPass', () => {
  it('adds a Retour the first time it is taken, then counts it', () => {
    const once = countTaken([], REVIEW_TO_CODE);
    expect(once).toEqual([{ from: 'st-review', to: 'st-code', taken: 1, extra: 0 }]);
    expect(countTaken(once, REVIEW_TO_CODE)).toEqual([{ from: 'st-review', to: 'st-code', taken: 2, extra: 0 }]);
  });

  it('allows one more pass of a Retour, leaving the others as they are', () => {
    const rv = { from: 'st-rv', to: 'st-code', taken: 1, extra: 0 };
    expect(withExtraPass([{ from: 'st-review', to: 'st-code', taken: 3, extra: 0 }, rv], REVIEW_TO_CODE)).toEqual([{ from: 'st-review', to: 'st-code', taken: 3, extra: 1 }, rv]);
  });
});
