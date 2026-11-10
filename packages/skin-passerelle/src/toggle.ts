import { Toggle } from '@crewdeck/sdk';
import { css, html, nothing, type PropertyValues } from 'lit';
import { sharedStyles } from './base.js';
import { fieldStyles, PasserelleFormElement } from './form.js';

/**
 * `cd-toggle`: a native `<button role="switch">` with `aria-checked`, named by
 * its label and described by its help; a click or Space (a button's own
 * keys) toggles it. Checked, it submits `on` under `name`; it sends `input`
 * and `change` from its host.
 */
export class PasserelleToggle extends PasserelleFormElement<typeof Toggle> {
  static override styles = [
    sharedStyles,
    fieldStyles,
    css`
      .toggle {
        display: flex;
        align-items: center;
        gap: var(--cd-space-4);
        min-height: var(--cd-touch);
        cursor: pointer;
      }
      .text {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-1);
        min-width: 0;
      }
      .text .help {
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
      }
      .switch {
        position: relative;
        flex: none;
        width: var(--cd-space-10);
        height: var(--cd-space-6);
        border-radius: var(--cd-radius-full);
        background: var(--cd-sunk);
        border: thin solid var(--cd-control-border);
      }
      /* 44 px to the touch (DESIGN.md, Layout). */
      .switch::after {
        content: '';
        position: absolute;
        inset: calc((var(--cd-touch) - var(--cd-space-6)) / -2) 0;
      }
      .knob {
        position: absolute;
        top: 50%;
        left: var(--cd-space-1);
        width: var(--cd-space-4);
        height: var(--cd-space-4);
        transform: translateY(-50%);
        border-radius: var(--cd-radius-full);
        background: var(--cd-muted);
      }
      .switch[aria-checked='true'] {
        background: var(--cd-accent);
        border-color: var(--cd-accent);
      }
      .switch[aria-checked='true'] .knob {
        left: auto;
        right: var(--cd-space-1);
        background: var(--cd-accent-ink);
      }
      .switch:disabled {
        cursor: not-allowed;
      }
    `,
  ];

  protected readonly composant = Toggle;

  /** `data.checked`, then the Pilote's toggling, until `data.checked` changes. */
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
    this.submitChecked();
  }

  private submitChecked() {
    this.submit(this.data.name, this.current && this.data.state !== 'disabled' ? 'on' : null);
  }

  private onClick() {
    if (this.data.state === 'disabled') return;
    this.current = !this.current;
    this.requestUpdate();
    this.submitChecked();
    this.sendInputAndChange();
  }

  protected override render() {
    const { label, help, state } = this.data;
    const disabled = state === 'disabled';
    return html`<label part="toggle" class="toggle ${disabled ? 'disabled' : ''}">
      <span class="text">
        <span id="label" class="label" part="label">${label}</span>
        ${help ? html`<span id="help" class="help" part="help">${help}</span>` : nothing}
      </span>
      <button
        part="switch"
        type="button"
        role="switch"
        class="switch"
        aria-checked=${this.current ? 'true' : 'false'}
        aria-labelledby="label"
        aria-describedby=${help ? 'help' : nothing}
        ?disabled=${disabled}
        @click=${this.onClick}
      >
        <span class="knob"></span>
      </button>
    </label>`;
  }
}
