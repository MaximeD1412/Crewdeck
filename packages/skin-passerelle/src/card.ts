import { Card } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { isFilled, PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-card`: a panel, its `section-label` title with its count and actions,
 * then its content. With a `label` it is a `section` landmark; `flush` drops
 * its content's padding, for a list of `cd-list-row`s.
 */
export class PasserelleCard extends PasserelleElement<typeof Card> {
  static override properties = { hasActions: { state: true } };
  static override styles = [
    sharedStyles,
    css`
      .card {
        background: var(--cd-panel);
        border: thin solid var(--cd-line);
        border-radius: var(--cd-radius-lg);
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .head {
        display: flex;
        align-items: center;
        gap: var(--cd-space-3);
        padding: var(--cd-space-3) var(--cd-space-4) 0;
        min-height: var(--cd-touch);
      }
      .flush .head {
        padding-bottom: var(--cd-space-2);
      }
      h2 {
        display: flex;
        align-items: center;
        gap: var(--cd-space-2);
        font: var(--cd-font-section-label-weight) var(--cd-font-section-label-size) /
          var(--cd-font-section-label-line-height) var(--cd-font-section-label-family), sans-serif;
        letter-spacing: var(--cd-font-section-label-letter-spacing);
        text-transform: uppercase;
        color: var(--cd-muted);
      }
      .count {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        letter-spacing: 0;
      }
      .actions {
        margin-left: auto;
        display: flex;
        gap: var(--cd-space-2);
      }
      .body {
        padding: var(--cd-space-3) var(--cd-space-4) var(--cd-space-4);
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-3);
        min-width: 0;
      }
      .flush .body {
        padding: 0;
        gap: 0;
      }
    `,
  ];

  protected readonly composant = Card;
  declare hasActions: boolean;

  constructor() {
    super();
    this.hasActions = false;
  }

  protected override render() {
    const { title, count, label, flush } = this.data;
    const content = html`
      <div class="head" ?hidden=${title === undefined && !this.hasActions}>
        ${title === undefined
          ? nothing
          : html`<h2>${title}${count === undefined ? nothing : html`<span class="count">${count}</span>`}</h2>`}
        <div class="actions">
          <slot name="actions" @slotchange=${(e: Event) => (this.hasActions = isFilled(e.target as HTMLSlotElement))}></slot>
        </div>
      </div>
      <div class="body" part="body"><slot></slot></div>
    `;
    const classes = `card ${flush ? 'flush' : ''}`;
    return label === undefined
      ? html`<div part="card" class=${classes}>${content}</div>`
      : html`<section part="card" class=${classes} aria-label=${label}>${content}</section>`;
  }
}
