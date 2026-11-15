import { Toast } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/** `cd-toast`: a short `status` on a raised card with its tone's rail; no close button, the core removes it. */
export class PasserelleToast extends PasserelleElement<typeof Toast> {
  static override styles = [
    sharedStyles,
    css`
      .toast {
        display: flex;
        align-items: flex-start;
        gap: var(--cd-space-2);
        padding: var(--cd-space-3) var(--cd-space-4);
        background: var(--cd-raised);
        border: thin solid var(--cd-line-strong);
        border-left: var(--cd-rail) solid var(--cd-accent);
        border-radius: var(--cd-radius-lg);
        box-shadow: 0 var(--cd-space-2) var(--cd-space-6) var(--cd-shadow);
        color: var(--cd-ink);
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
      }
      cd-icon {
        flex: none;
        margin-top: var(--cd-space-1);
        color: var(--cd-accent-text);
      }
      .halt {
        border-left-color: var(--cd-halt);
      }
      .halt cd-icon {
        color: var(--cd-halt);
      }
      .go {
        border-left-color: var(--cd-go);
      }
      .go cd-icon {
        color: var(--cd-go);
      }
    `,
  ];

  protected readonly composant = Toast;

  protected override render() {
    const { tone, icon, text } = this.data;
    return html`<div part="toast" class="toast ${tone}" role="status">
      ${icon ? html`<cd-icon .data=${{ name: icon, size: 'sm' }}></cd-icon>` : nothing}<span>${text}</span>
    </div>`;
  }
}
