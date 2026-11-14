import { Checkbox } from '@crewdeck/sdk';
import { css, html, nothing, type PropertyValues } from 'lit';
import { live } from 'lit/directives/live.js';
import { sharedStyles } from './base.js';
import { choiceStyles } from './choice.js';
import { PasserelleFormElement } from './form.js';

/** `cd-checkbox`: a native checkbox inside its label, its `meta` under the label; checked, it submits `on` under `name`. */
export class PasserelleCheckbox extends PasserelleFormElement<typeof Checkbox> {
  static override styles = [
    sharedStyles,
    choiceStyles,
    css`
      input {
        border-radius: var(--cd-radius-sm);
        color: var(--cd-accent-ink);
      }
      .text {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      small {
        color: var(--cd-muted);
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
      }
      input:checked {
        background: var(--cd-accent);
        border-color: var(--cd-accent);
      }
      /* The check mark, drawn by the borders of a rotated box. */
      input:checked::after {
        content: '';
        width: calc(var(--cd-space-1) * 1.25);
        height: calc(var(--cd-space-2) * 1.25);
        margin-top: calc(var(--cd-stroke) * -1);
        border: solid currentColor;
        border-width: 0 var(--cd-stroke) var(--cd-stroke) 0;
        transform: rotate(45deg);
      }
    `,
  ];

  protected readonly composant = Checkbox;

  private current = false;

  get checked(): boolean {
    return this.current;
  }

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (this.dataChanged(changed, 'checked')) this.current = this.data.checked;
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    this.submit(this.data.name, this.current ? 'on' : null);
  }

  /** On `input`, which the browser sends before `change`: whoever hears it reads the new state. */
  private onInput(event: Event) {
    this.current = (event.target as HTMLInputElement).checked;
    this.submit(this.data.name, this.current ? 'on' : null);
  }

  protected override render() {
    return html`<label part="choice">
      <input part="control" type="checkbox" .checked=${live(this.current)} @input=${this.onInput} @change=${this.forwardChange} />
      <span class="text"
        ><span part="label">${this.data.label}</span>${this.data.meta === undefined ? nothing : html`<small part="meta">${this.data.meta}</small>`}</span
      >
    </label>`;
  }
}
