import { TextField } from '@crewdeck/sdk';
import { css, html, nothing, type PropertyValues } from 'lit';
import { sharedStyles } from './base.js';
import { fieldStyles, PasserelleFormElement } from './form.js';

/**
 * `cd-text-field`: a native `<input>`, or `<textarea>` when `multiline`,
 * labelled by its `label` and described by its help and its error. It submits
 * what it holds under `name`; with an `error` it is invalid to its form and
 * the message is under the field, in `halt`; disabled, it submits nothing.
 */
export class PasserelleTextField extends PasserelleFormElement<typeof TextField> {
  static override styles = [
    sharedStyles,
    fieldStyles,
    css`
      textarea.control {
        display: block;
        resize: vertical;
        min-height: var(--cd-text-area);
        height: var(--cd-text-area);
      }
    `,
  ];

  protected readonly composant = TextField;

  /** What the field holds: `data.value`, then what is typed, until `data.value` changes. */
  private current = '';

  get value(): string {
    return this.current;
  }

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (this.dataChanged(changed, 'value')) this.current = this.data.value;
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    const { name, error, state } = this.data;
    this.submit(name, state === 'disabled' ? null : this.current);
    const control = this.shadowRoot?.querySelector<HTMLElement>('.control') ?? undefined;
    if (error && state !== 'disabled') this.internals.setValidity({ customError: true }, error, control);
    else this.internals.setValidity({});
  }

  private onInput(event: Event) {
    this.current = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.submit(this.data.name, this.current);
  }

  protected override render() {
    const { label, placeholder, help, error, state, multiline, maxLength } = this.data;
    const disabled = state === 'disabled';
    const describedBy = [help ? 'help' : '', error ? 'error' : ''].filter(Boolean).join(' ');
    const attrs = {
      placeholder: placeholder ?? nothing,
      maxlength: maxLength ?? nothing,
      describedBy: describedBy || nothing,
      invalid: error ? 'true' : nothing,
    };
    const control = multiline
      ? html`<textarea
          id="control"
          part="control"
          class="control"
          .value=${this.current}
          placeholder=${attrs.placeholder}
          maxlength=${attrs.maxlength}
          ?disabled=${disabled}
          aria-describedby=${attrs.describedBy}
          aria-invalid=${attrs.invalid}
          @input=${this.onInput}
          @change=${this.forwardChange}
        ></textarea>`
      : html`<input
          id="control"
          part="control"
          class="control"
          type="text"
          .value=${this.current}
          placeholder=${attrs.placeholder}
          maxlength=${attrs.maxlength}
          ?disabled=${disabled}
          aria-describedby=${attrs.describedBy}
          aria-invalid=${attrs.invalid}
          @input=${this.onInput}
          @change=${this.forwardChange}
        />`;
    return html`<div part="field" class="field ${error ? 'invalid' : ''} ${disabled ? 'disabled' : ''}">
      <label for="control" part="label">${label}</label>
      ${control}
      ${error ? html`<span id="error" class="error" part="error">${error}</span>` : nothing}
      ${help ? html`<span id="help" class="help" part="help">${help}</span>` : nothing}
    </div>`;
  }
}
