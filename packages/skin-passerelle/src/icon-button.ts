import { IconButton } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/** `cd-icon-button`: a native `<button>` that is only an icon; its `label` is its name and its tooltip. */
export class PasserelleIconButton extends PasserelleElement<typeof IconButton> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: inline-flex;
      }
      button {
        width: var(--cd-touch);
        height: var(--cd-touch);
        display: inline-grid;
        place-items: center;
        border-radius: var(--cd-radius);
        color: var(--cd-ink-2);
      }
      button:hover {
        background: var(--cd-raised);
        color: var(--cd-ink);
      }
    `,
  ];

  protected readonly composant = IconButton;

  protected override render() {
    const { icon, label } = this.data;
    return html`<button part="button" type="button" aria-label=${label} title=${label}>
      <cd-icon .data=${{ name: icon, size: 'md' }}></cd-icon>
    </button>`;
  }
}
