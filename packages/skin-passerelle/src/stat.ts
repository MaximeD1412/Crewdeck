import { Stat } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-stat`: a figure in a panel, its label as a caption, its value in the
 * `stat` type with tabular figures and its unit smaller, then what it
 * measures in mono. The value comes formatted from the view.
 */
export class PasserelleStat extends PasserelleElement<typeof Stat> {
  static override styles = [
    sharedStyles,
    css`
      .stat {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-1);
        padding: var(--cd-space-4);
        background: var(--cd-panel);
        border: thin solid var(--cd-line);
        border-radius: var(--cd-radius-lg);
      }
      .label {
        font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
          var(--cd-font-caption-family), sans-serif;
        color: var(--cd-muted);
      }
      .value {
        font: var(--cd-font-stat-weight) var(--cd-font-stat-size) / var(--cd-font-stat-line-height)
          var(--cd-font-stat-family), sans-serif;
        font-variant-numeric: tabular-nums;
        color: var(--cd-ink);
      }
      .value small {
        font: var(--cd-font-label-weight) var(--cd-font-label-size) / 1 var(--cd-font-label-family), sans-serif;
        color: var(--cd-muted);
      }
      .detail {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-muted);
      }
    `,
  ];

  protected readonly composant = Stat;

  protected override render() {
    const { label, value, unit, detail } = this.data;
    return html`<div class="stat" part="stat">
      <span class="label">${label}</span>
      <span class="value">${value}${unit === null ? nothing : html`<small> ${unit}</small>`}</span>
      ${detail === null ? nothing : html`<span class="detail">${detail}</span>`}
    </div>`;
  }
}
