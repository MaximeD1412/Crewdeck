import type { AnyComposant } from '@crewdeck/sdk';
import { css, type PropertyValues } from 'lit';
import { PasserelleElement } from './base.js';

/**
 * The look the form Composants share (DESIGN.md « Forms », « Interactive
 * states »): a label over its control, the control's border in
 * `--cd-control-border` (3:1 on `panel` and `side`), the help under it; in
 * error the border, the help and the message under the field in `halt`;
 * disabled, the control at 45 % with no pointer, its label and its help kept
 * readable (as a Button's reason).
 */
export const fieldStyles = css`
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--cd-space-2);
  }
  label,
  .label {
    font: var(--cd-font-label-weight) var(--cd-font-label-size) / var(--cd-font-label-line-height)
      var(--cd-font-label-family), sans-serif;
    color: var(--cd-ink);
  }
  .control {
    width: 100%;
    min-height: var(--cd-touch);
    margin: 0;
    padding: var(--cd-space-2) var(--cd-space-3);
    border-radius: var(--cd-radius);
    border: thin solid var(--cd-control-border);
    background: var(--cd-side);
    color: var(--cd-ink);
    font: var(--cd-font-body-weight) var(--cd-font-body-size) / var(--cd-font-body-line-height)
      var(--cd-font-body-family), sans-serif;
  }
  .control::placeholder {
    color: var(--cd-muted);
  }
  .control:hover:enabled {
    border-color: var(--cd-muted);
  }
  .control:focus {
    border-color: var(--cd-accent);
  }
  .control:focus-visible,
  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible {
    outline: var(--cd-stroke) solid var(--cd-accent);
    outline-offset: var(--cd-stroke);
  }
  .help,
  .error {
    font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
      var(--cd-font-caption-family), sans-serif;
    color: var(--cd-muted);
  }
  .invalid .control {
    border-color: var(--cd-halt);
  }
  .invalid .help,
  .error {
    color: var(--cd-halt);
  }
  .disabled .control,
  .disabled cd-icon {
    opacity: 0.45;
  }
  .disabled,
  .disabled * {
    cursor: not-allowed;
  }
`;

/**
 * The base of the form Composants (ADR 0006, `ElementInternals`): they emit no
 * `cd-action`; they take part in their `<form>` (`submit()` sets the entry
 * under its name, `null` none) and send the native `input` and `change`
 * events composed, `input` crossing the shadow root by itself, `change`
 * re-sent from the host (`forwardChange`).
 */
export abstract class PasserelleFormElement<C extends AnyComposant> extends PasserelleElement<C> {
  static formAssociated = true;

  protected readonly internals: ElementInternals = this.attachInternals();

  get form(): HTMLFormElement | null {
    return this.internals.form;
  }

  get validity(): ValidityState {
    return this.internals.validity;
  }

  get validationMessage(): string {
    return this.internals.validationMessage;
  }

  checkValidity(): boolean {
    return this.internals.checkValidity();
  }

  reportValidity(): boolean {
    return this.internals.reportValidity();
  }

  /** The form's entry: `value` under `name`, or none. */
  /**
   * Whether `data[key]` came or changed in this update: the control then
   * starts again from it. Any other update (the Pilote's own edit) keeps what
   * the Pilote did.
   */
  protected dataChanged(changed: PropertyValues, key: string): boolean {
    if (!changed.has('data')) return false;
    const previous = changed.get('data') as Record<string, unknown> | undefined;
    return previous === undefined || previous[key] !== (this.data as Record<string, unknown>)[key];
  }

  protected submit(name: string, value: string | null): void {
    if (value === null) {
      this.internals.setFormValue(null);
      return;
    }
    const entry = new FormData();
    entry.append(name, value);
    this.internals.setFormValue(entry);
  }

  /** A `change` does not leave a shadow root: the host sends it again, composed. */
  protected forwardChange(): void {
    this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  /** Both events, for a control that is not a native input (Toggle). */
  protected sendInputAndChange(): void {
    this.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    this.forwardChange();
  }
}
