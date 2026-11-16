import { CATALOGUE, type LoopBack, loopBackFrom, type PhaseRunLoopBack, type ProcessDefinition } from '@crewdeck/contracts';

/**
 * The counting of the Retours (ADR 0011, « A Retour »; risk AGT-9: no loop
 * runs without end), pure: what a Verdict « changements » of an Étape does
 * to its PhaseRun. `Engine.signal` and « Encore un passage » write what it
 * says.
 */

/**
 * What a Verdict « changements » of `stepId` leads to:
 * - `take`: the Retour it leaves runs the work again from its target, taken
 *   `taken` times so far, fewer than its `max` and the passes allowed beyond;
 * - `exhausted`: it was taken that many times, the item stops on the
 *   Décision `loop-back.exhausted`, which offers one more pass;
 * - `no-loop-back`: no Retour leaves it, the item stops on the same Décision
 *   without one more pass;
 * - `refused`: a gate without a Retour cannot ask for changes (its command
 *   was never offered).
 */
export type AfterChanges =
  | { readonly move: 'take' | 'exhausted'; readonly loopBack: LoopBack; readonly taken: number }
  | { readonly move: 'no-loop-back' }
  | { readonly move: 'refused' };

const sameLoopBack = (counted: PhaseRunLoopBack, loopBack: LoopBack): boolean => counted.from === loopBack.from && counted.to === loopBack.to;

export const afterChanges = (definition: ProcessDefinition, counted: readonly PhaseRunLoopBack[], stepId: string): AfterChanges => {
  const loopBack = loopBackFrom(definition, stepId);
  if (!loopBack) {
    const step = definition.steps.find((candidate) => candidate.id === stepId);
    return step && CATALOGUE[step.kind].family === 'gate' ? { move: 'refused' } : { move: 'no-loop-back' };
  }
  const { taken, extra } = counted.find((candidate) => sameLoopBack(candidate, loopBack)) ?? { taken: 0, extra: 0 };
  return { move: taken < loopBack.max + extra ? 'take' : 'exhausted', loopBack, taken };
};

const update = (counted: readonly PhaseRunLoopBack[], loopBack: LoopBack, change: (current: PhaseRunLoopBack) => PhaseRunLoopBack): PhaseRunLoopBack[] =>
  counted.some((candidate) => sameLoopBack(candidate, loopBack))
    ? counted.map((candidate) => (sameLoopBack(candidate, loopBack) ? change(candidate) : candidate))
    : [...counted, change({ from: loopBack.from, to: loopBack.to, taken: 0, extra: 0 })];

/** The Retours counted once `loopBack` is taken once more. */
export const countTaken = (counted: readonly PhaseRunLoopBack[], loopBack: LoopBack): PhaseRunLoopBack[] =>
  update(counted, loopBack, (current) => ({ ...current, taken: current.taken + 1 }));

/** The Retours counted once the Pilote allowed `loopBack` one more pass (« Encore un passage »). */
export const withExtraPass = (counted: readonly PhaseRunLoopBack[], loopBack: LoopBack): PhaseRunLoopBack[] =>
  update(counted, loopBack, (current) => ({ ...current, extra: current.extra + 1 }));
