import { Stepper, t } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/** The keys that change the value, by how much. */
const STEPS: Readonly<Record<string, number>> = { ArrowUp: 1, ArrowDown: -1 };

/**
 * `cd-stepper`: a group named by its label, « Moins » and « Plus » around a
 * polite `<output>` of « {value} {unit} ». Each button is disabled at its
 * bound; ArrowUp and ArrowDown on the group change the value too. It emits
 * `change` with the new value, never outside `min..max`, and keeps showing
 * its data's value until the core sets the new one.
 */
export class PasserelleStepper extends PasserelleElement<typeof Stepper> {
  static override styles = [
    sharedStyles,
    css`
      [role='group'] {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-1);
      }
      .label {
        font: var(--cd-font-label-weight) var(--cd-font-label-size) / var(--cd-font-label-line-height)
          var(--cd-font-label-family), sans-serif;
        color: var(--cd-ink);
      }
      .control {
        display: inline-flex;
        align-items: center;
        align-self: flex-start;
        border: thin solid var(--cd-control-border);
        border-radius: var(--cd-radius);
        background: var(--cd-sunk);
      }
      button {
        width: var(--cd-control);
        height: var(--cd-control);
        display: grid;
        place-items: center;
        color: var(--cd-ink-2);
        border-radius: var(--cd-radius);
      }
      button:hover:not(:disabled) {
        background: var(--cd-raised);
        color: var(--cd-ink);
      }
      button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      output {
        min-width: var(--cd-space-10);
        padding: 0 var(--cd-space-2);
        text-align: center;
        font: var(--cd-font-meta-weight) var(--cd-font-mono-size) / var(--cd-font-mono-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-ink);
      }
    `,
  ];

  protected readonly composant = Stepper;

  private change(by: number) {
    const { value, min, max } = this.data;
    const next = value + by;
    if (next >= min && next <= max) this.emit('change', { value: next });
  }

  private onKeydown(event: KeyboardEvent) {
    const by = STEPS[event.key];
    if (by === undefined) return;
    event.preventDefault();
    this.change(by);
  }

  protected override render() {
    const { label, value, unit, min, max } = this.data;
    return html`<div part="stepper" role="group" aria-labelledby="label" @keydown=${(event: KeyboardEvent) => this.onKeydown(event)}>
      <span class="label" id="label">${label}</span>
      <div class="control">
        <button type="button" class="decrease" aria-label=${t('stepper.decrease')} ?disabled=${value <= min} @click=${() => this.change(-1)}>
          <cd-icon .data=${{ name: 'minus', size: 'sm' }}></cd-icon>
        </button>
        <output aria-live="polite">${unit === null ? value : `${value} ${unit}`}</output>
        <button type="button" class="increase" aria-label=${t('stepper.increase')} ?disabled=${value >= max} @click=${() => this.change(1)}>
          <cd-icon .data=${{ name: 'plus', size: 'sm' }}></cd-icon>
        </button>
      </div>
    </div>`;
  }
}
