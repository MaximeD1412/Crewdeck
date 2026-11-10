import { Icon } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';
import { ICONS } from './icons.js';

/** `cd-icon`: an inline 24×24 stroke icon in the colour of the text around it, hidden from screen readers. */
export class PasserelleIcon extends PasserelleElement<typeof Icon> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: inline-flex;
        flex: none;
        color: inherit;
      }
      svg {
        width: var(--cd-icon);
        height: var(--cd-icon);
      }
      svg.sm {
        width: var(--cd-icon-sm);
        height: var(--cd-icon-sm);
      }
    `,
  ];

  protected readonly composant = Icon;

  protected override render() {
    return html`<svg
      class=${this.data.size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      ${ICONS[this.data.name]}
    </svg>`;
  }
}
