import { Chip } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/** `cd-chip`: a toggle `<button>` (`aria-pressed`) with its count; whoever places it emits the action. */
export class PasserelleChip extends PasserelleElement<typeof Chip> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: inline-flex;
        flex: none;
      }
      button {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: var(--cd-space-2);
        height: var(--cd-control-sm);
        padding: 0 var(--cd-space-3);
        white-space: nowrap;
        border: thin solid var(--cd-line-strong);
        border-radius: var(--cd-radius);
        background: var(--cd-panel);
        color: var(--cd-ink-2);
        font: var(--cd-font-label-weight) var(--cd-font-body-sm-size) / var(--cd-font-caption-line-height)
          var(--cd-font-label-family), sans-serif;
      }
      button::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        top: 50%;
        height: var(--cd-touch);
        transform: translateY(-50%);
      }
      button:hover {
        background: var(--cd-raised);
      }
      button[aria-pressed='true'] {
        background: var(--cd-accent-soft);
        border-color: var(--cd-accent);
        color: var(--cd-accent-text);
      }
      .count {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        opacity: 0.8;
      }
    `,
  ];

  protected readonly composant = Chip;

  protected override render() {
    const { label, count, selected } = this.data;
    return html`<button part="chip" type="button" aria-pressed=${selected ? 'true' : 'false'}>
      ${label}${count === undefined ? nothing : html`<span class="count">${count}</span>`}
    </button>`;
  }
}
