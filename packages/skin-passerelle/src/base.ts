import {
  emitAction,
  type AnyComposant,
  type ComposantAction,
  type ComposantData,
  type ComposantPayload,
} from '@crewdeck/sdk';
import { css, LitElement, type CSSResultGroup } from 'lit';

/** What every Passerelle Composant shares: the body type and colours, from the `--cd-*` tokens. */
export const sharedStyles = css`
  :host {
    display: block;
    box-sizing: border-box;
    color: var(--cd-ink);
    font: var(--cd-font-body-weight) var(--cd-font-body-size) / var(--cd-font-body-line-height)
      var(--cd-font-body-family), sans-serif;
  }
  :host([hidden]) {
    display: none;
  }
  *,
  *::before,
  *::after {
    box-sizing: inherit;
  }
  a {
    color: var(--cd-accent-text);
  }
  a:focus-visible {
    outline: var(--cd-stroke) solid var(--cd-accent);
    outline-offset: var(--cd-stroke);
  }
`;

/**
 * The base of the Passerelle's Composants: a Lit element in a shadow root
 * whose `data` property the core sets, and `emit()` for its actions.
 */
export abstract class PasserelleElement<C extends AnyComposant> extends LitElement {
  static override properties = { data: { attribute: false } };
  static override styles: CSSResultGroup = sharedStyles;

  /** Set by the core or by the Composant that places it; never decided here. */
  declare data: ComposantData<C>;

  /** The declaration this element implements. */
  protected abstract readonly composant: C;

  /** Emits one of the Composant's actions as a `cd-action`. */
  protected emit<A extends ComposantAction<C>>(action: A, payload: ComposantPayload<C, A>): void {
    emitAction(this, this.composant, action, payload);
  }
}
