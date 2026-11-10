import {
  emitAction,
  type AnyComposant,
  type ComposantAction,
  type ComposantData,
  type ComposantPayload,
} from '@crewdeck/sdk';
import { css, LitElement, type CSSResultGroup, type PropertyDeclarations, type PropertyValues } from 'lit';

/**
 * What every Passerelle Composant shares: the body type and colours, from the
 * `--cd-*` tokens, native controls reset, and the focus ring of DESIGN.md (a
 * `--cd-stroke` outline in the accent, offset by as much). Hairlines are
 * `thin`: a 1 px line is not a token.
 */
export const sharedStyles = css`
  :host {
    display: block;
    box-sizing: border-box;
    color: var(--cd-ink);
    font: var(--cd-font-body-weight) var(--cd-font-body-size) / var(--cd-font-body-line-height)
      var(--cd-font-body-family), sans-serif;
  }
  :host([hidden]),
  [hidden] {
    display: none !important;
  }
  *,
  *::before,
  *::after {
    box-sizing: inherit;
  }
  h1,
  h2,
  p {
    margin: 0;
  }
  a {
    color: var(--cd-accent-text);
    text-decoration: none;
  }
  a:hover {
    color: var(--cd-accent-hover);
  }
  button {
    font: inherit;
    color: inherit;
    background: none;
    border: 0;
    padding: 0;
    margin: 0;
    cursor: pointer;
  }
  a:focus-visible,
  button:focus-visible {
    outline: var(--cd-stroke) solid var(--cd-accent);
    outline-offset: var(--cd-stroke);
  }
  code {
    font: var(--cd-font-mono-weight) var(--cd-font-mono-size) / var(--cd-font-mono-line-height)
      var(--cd-font-mono-family), monospace;
  }
  .visually-hidden {
    position: absolute;
    width: var(--cd-stroke);
    height: var(--cd-stroke);
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
`;

/**
 * The base of the Passerelle's Composants: a Lit element in a shadow root
 * whose `data` the core sets as a property, or an example's HTML as a JSON
 * `data` attribute (a Composant placed in another's Emplacement), and
 * `emit()` for its actions. Nothing renders before its data.
 */
export abstract class PasserelleElement<C extends AnyComposant> extends LitElement {
  static override properties: PropertyDeclarations = { data: { type: Object } };
  static override styles: CSSResultGroup = sharedStyles;

  /** Set by the core or by the Composant that places it; never decided here. */
  declare data: ComposantData<C>;

  /** The declaration this element implements. */
  protected abstract readonly composant: C;

  protected override shouldUpdate(changed: PropertyValues): boolean {
    return this.data !== undefined && super.shouldUpdate(changed);
  }

  /** Emits one of the Composant's actions as a `cd-action`. */
  protected emit<A extends ComposantAction<C>>(action: A, payload: ComposantPayload<C, A>): void {
    emitAction(this, this.composant, action, payload);
  }
}

/** Whether a slot holds an element or some text: its frame is hidden otherwise. */
export const isFilled = (slot: HTMLSlotElement): boolean =>
  slot.assignedNodes({ flatten: true }).some((node) => node.nodeType === Node.ELEMENT_NODE || node.textContent?.trim());
