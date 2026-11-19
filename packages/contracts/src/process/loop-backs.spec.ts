import type { ProcessDefinition } from './definition.js';
import { canAskChanges, loopBackFrom } from './loop-backs.js';
import { PROCESS_CREWDECK } from './templates/process-crewdeck.js';

const withoutLoopBackFrom = (stepId: string): ProcessDefinition => ({ ...PROCESS_CREWDECK, loopBacks: PROCESS_CREWDECK.loopBacks.filter((loopBack) => loopBack.from !== stepId) });

describe('loopBackFrom', () => {
  it('is the Retour that leaves the Étape, its target and maximum', () => {
    expect(loopBackFrom(PROCESS_CREWDECK, 'st-review')).toEqual({ from: 'st-review', to: 'st-code', max: 3 });
    expect(loopBackFrom(PROCESS_CREWDECK, 'st-ap-tickets')).toEqual({ from: 'st-ap-tickets', to: 'st-decoupage', max: 3 });
  });

  it('is null for an Étape no Retour leaves, one it only reaches, and an Étape that does not exist', () => {
    expect(loopBackFrom(PROCESS_CREWDECK, 'st-checks')).toBeNull();
    expect(loopBackFrom(PROCESS_CREWDECK, 'st-code')).toBeNull();
    expect(loopBackFrom(PROCESS_CREWDECK, 'st-nowhere')).toBeNull();
    expect(loopBackFrom(withoutLoopBackFrom('st-review'), 'st-review')).toBeNull();
  });
});

describe('canAskChanges', () => {
  it('holds for an Étape that judges and that a Retour leaves: the Review, the Revue visuelle, an approval', () => {
    expect(canAskChanges(PROCESS_CREWDECK, 'st-review')).toBe(true);
    expect(canAskChanges(PROCESS_CREWDECK, 'st-rv')).toBe(true);
    expect(canAskChanges(PROCESS_CREWDECK, 'st-ap-prd')).toBe(true);
  });

  it('does not for an Étape that judges without a Retour, nor one that does not judge, nor an Étape that does not exist', () => {
    expect(canAskChanges(withoutLoopBackFrom('st-rv'), 'st-rv')).toBe(false);
    expect(canAskChanges(PROCESS_CREWDECK, 'st-checks')).toBe(false);
    expect(canAskChanges(PROCESS_CREWDECK, 'st-code')).toBe(false);
    expect(canAskChanges(PROCESS_CREWDECK, 'st-nowhere')).toBe(false);
  });
});
