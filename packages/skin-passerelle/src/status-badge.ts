import { StatusBadge } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/** `cd-status-badge`: a short state in a badge of its tone. */
export class PasserelleStatusBadge extends PasserelleElement<typeof StatusBadge> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: inline-flex;
      }
      span {
        display: inline-flex;
        align-items: center;
        gap: var(--cd-space-1);
        padding: 0 var(--cd-space-2);
        border-radius: var(--cd-radius-sm);
        white-space: nowrap;
        font: 500 var(--cd-font-meta-size) / var(--cd-font-meta-line-height) var(--cd-font-meta-family), monospace;
        background: var(--cd-sunk);
        color: var(--cd-ink-2);
      }
      .accent {
        background: var(--cd-accent-soft);
        color: var(--cd-accent-text);
      }
      .go {
        background: var(--cd-go-soft);
        color: var(--cd-go);
      }
      .caution {
        background: var(--cd-caution-soft);
        color: var(--cd-caution);
      }
      .halt {
        background: var(--cd-halt-soft);
        color: var(--cd-halt);
      }
    `,
  ];

  protected readonly composant = StatusBadge;

  protected override render() {
    return html`<span part="badge" class=${this.data.tone}>${this.data.label}</span>`;
  }
}
