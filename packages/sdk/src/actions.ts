import {
  CD_ACTION,
  type AnyComposant,
  type CdActionDetail,
  type ComposantAction,
  type ComposantPayload,
} from '@crewdeck/contracts/composants';

/**
 * Emits one of `composant`'s actions from `el`: a `cd-action` event that
 * bubbles and crosses shadow roots up to the core's listener, which checks the
 * payload against the declaration before running anything.
 */
export const emitAction = <C extends AnyComposant, A extends ComposantAction<C>>(
  el: EventTarget,
  composant: C,
  action: A,
  payload: ComposantPayload<C, A>,
): void => {
  const detail: CdActionDetail = { composant: composant.name, action, payload };
  el.dispatchEvent(new CustomEvent(CD_ACTION, { bubbles: true, composed: true, detail }));
};
