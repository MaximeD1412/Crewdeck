import { SettingRow, t } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-setting-row`: a setting of the Paramètres, its label, its help and where
 * its value comes from (« Hérité du compte », « Modifié pour ce Projet »),
 * then its control in the default Emplacement: under them on the phone, beside
 * them at 1280 px. Rows that follow each other are parted by a line.
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
      .origin {
        display: inline-flex;
        align-items: center;
        gap: var(--cd-space-2);
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-muted);
      }
      .origin::before {
        content: '';
        width: var(--cd-dot);
        height: var(--cd-dot);
        border-radius: var(--cd-radius-full);
        background: var(--cd-line-strong);
      }
      .projet {
        color: var(--cd-accent-text);
      }
      .projet::before {
        background: var(--cd-accent);
      }
      .control {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
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
    const { label, help, origin } = this.data;
    return html`<div part="setting" class="setting">
      <div class="text">
        <span class="label" part="label">${label}</span>
        ${help ? html`<span class="help" part="help">${help}</span>` : nothing}
        ${origin
          ? html`<span class="origin ${origin}" part="origin">
              ${t(origin === 'projet' ? 'settingRow.changed' : 'settingRow.inherited')}
            </span>`
          : nothing}
      </div>
      <div class="control" part="control"><slot></slot></div>
    </div>`;
  }
}
