import { SettingRow, t } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-setting-row`: a setting of the Paramètres, its label, its help and where
 * its value comes from (« Hérité du compte », « Modifié pour ce Projet »),
 * then its control in the default Emplacement: under them on the phone, beside
 * them at 1280 px. Rows that follow each other are parted by a line. Its
 * label names the control: a form Composant placed in it hides its own label,
 * which stays its accessible name.
 */
export class PasserelleSettingRow extends PasserelleElement<typeof SettingRow> {
  static override styles = [
    sharedStyles,
    css`
      .setting {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-3);
        padding: var(--cd-space-4) 0;
        border-top: thin solid var(--cd-line);
      }
      :host(:first-child) .setting {
        border-top: 0;
        padding-top: 0;
      }
      .text {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-1);
      }
      .label {
        font: var(--cd-font-label-weight) var(--cd-font-label-size) / var(--cd-font-label-line-height)
          var(--cd-font-label-family), sans-serif;
        color: var(--cd-ink);
      }
      .help {
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
        color: var(--cd-muted);
      }
      .origin,
      .revert {
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
      }
      .origin {
        display: inline-flex;
        align-items: center;
        gap: var(--cd-space-2);
        color: var(--cd-muted);
      }
      .origin::before {
        content: '';
        width: var(--cd-dot);
        height: var(--cd-dot);
        border-radius: var(--cd-radius-full);
        background: var(--cd-line-strong);
      }
      .projet::before {
        background: var(--cd-accent);
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cd-space-3);
      }
      .revert {
        color: var(--cd-accent-text);
        min-height: var(--cd-control-sm);
      }
      .revert:hover {
        color: var(--cd-accent-hover);
      }
      .control {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
      }
      /* The row's label names its control: the form Composants' own label is kept for assistive tech only (\`fieldStyles\`). */
      ::slotted(*) {
        --cd-field-label-position: absolute;
        --cd-field-label-size: var(--cd-stroke);
        --cd-field-label-overflow: hidden;
        --cd-field-label-clip: inset(50%);
        --cd-field-label-white-space: nowrap;
      }
      @media (min-width: 1280px) {
        .setting {
          flex-direction: row;
          align-items: flex-start;
          gap: var(--cd-space-8);
        }
        .text {
          flex: 1;
        }
        .control {
          width: var(--cd-aside-width);
          flex: none;
        }
      }
    `,
  ];

  protected readonly composant = SettingRow;

  protected override render() {
    const { label, help, origin, name } = this.data;
    return html`<div part="setting" class="setting">
      <div class="text">
        <span class="label" part="label">${label}</span>
        ${help ? html`<span class="help" part="help">${help}</span>` : nothing}
        ${origin
          ? html`<span class="meta">
              <span class="origin ${origin}" part="origin">${t(origin === 'projet' ? 'settingRow.changed' : 'settingRow.inherited')}</span>
              ${origin === 'projet' && name
                ? html`<button type="button" class="revert" part="revert" aria-label=${t('settingRow.revertLabel', { label })} @click=${() => this.emit('revert', { name })}>
                    ${t('settingRow.revert')}
                  </button>`
                : nothing}
            </span>`
          : nothing}
      </div>
      <div class="control" part="control"><slot></slot></div>
    </div>`;
  }
}
