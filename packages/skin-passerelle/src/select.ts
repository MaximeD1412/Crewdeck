import { Select } from '@crewdeck/sdk';
import { css, html, nothing, type PropertyValues } from 'lit';
import { sharedStyles } from './base.js';
import { fieldStyles, PasserelleFormElement } from './form.js';

/**
 * `cd-select`: the native `<select>` (no custom dropdown: its accessibility,
 * the phones' pickers), labelled by its `label`, described by its help. It
 * submits the chosen option's value under `name`; disabled, nothing.
 */
export class PasserelleSelect extends PasserelleFormElement<typeof Select> {
  static override styles = [
    sharedStyles,
    fieldStyles,
    css`
      .wrap {
        position: relative;
        display: flex;
        align-items: center;
      }
      select.control {
        appearance: none;
        padding-right: calc(var(--cd-space-3) * 2 + var(--cd-icon-sm));
        cursor: pointer;
        text-overflow: ellipsis;
      }
      cd-icon {
        position: absolute;
        right: var(--cd-space-3);
        color: var(--cd-muted);
        pointer-events: none;
      }
    `,
  ];

  protected readonly composant = Select;

  /** The chosen value: `data.value`, then the Pilote's choice, until `data.value` changes. */
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
    this.submit(this.data.name, this.data.state === 'disabled' ? null : this.current);
  }

  private onInput(event: Event) {
    this.current = (event.target as HTMLSelectElement).value;
    this.submit(this.data.name, this.current);
  }

  protected override render() {
    const { label, options, help, state } = this.data;
    const disabled = state === 'disabled';
    return html`<div part="field" class="field ${disabled ? 'disabled' : ''}">
      <label for="control" part="label">${label}</label>
      <div class="wrap">
        <select
          id="control"
          part="control"
          class="control"
          ?disabled=${disabled}
          aria-describedby=${help ? 'help' : nothing}
          @input=${this.onInput}
          @change=${this.forwardChange}
        >
          ${options.map(
            (option) =>
              html`<option value=${option.value} ?disabled=${option.disabled} ?selected=${option.value === this.current}>
                ${option.label}
              </option>`,
          )}
        </select>
        <cd-icon .data=${{ name: 'chevron-down', size: 'sm' }}></cd-icon>
      </div>
      ${help ? html`<span id="help" class="help" part="help">${help}</span>` : nothing}
    </div>`;
  }
}
