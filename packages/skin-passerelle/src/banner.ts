import { Banner } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { isFilled, PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-banner`: a message across the page, with the rail of its tone. A
 * `status` the screen readers read when it appears, an `alert` for `halt`.
 */
export class PasserelleBanner extends PasserelleElement<typeof Banner> {
  static override properties = { hasActions: { state: true } };
  static override styles = [
    sharedStyles,
    css`
      .banner {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: var(--cd-space-1) var(--cd-space-3);
        align-items: start;
        padding: var(--cd-space-3) var(--cd-space-4);
        border-radius: var(--cd-radius-lg);
        border: thin solid var(--cd-line);
        border-left: var(--cd-rail) solid var(--cd-accent);
        background: var(--cd-panel);
      }
      .icon {
        color: var(--cd-accent-text);
        margin-top: var(--cd-space-1);
      }
      .caution {
        border-left-color: var(--cd-caution);
        background: var(--cd-caution-soft);
      }
      .caution .icon {
        color: var(--cd-caution);
      }
      .halt {
        border-left-color: var(--cd-halt);
        background: var(--cd-halt-soft);
      }
      .halt .icon {
        color: var(--cd-halt);
      }
      .go {
        border-left-color: var(--cd-go);
      }
      .go .icon {
        color: var(--cd-go);
      }
      .neutral {
        border-left-color: var(--cd-line-strong);
      }
      .neutral .icon {
        color: var(--cd-muted);
      }
      .body {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-1);
      }
      .title {
        font: var(--cd-font-title-weight) var(--cd-font-label-size) / var(--cd-font-title-line-height)
          var(--cd-font-title-family), sans-serif;
        color: var(--cd-ink);
      }
      .text {
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
        color: var(--cd-ink-2);
      }
      .actions {
        grid-column: 2;
        display: flex;
        flex-wrap: wrap;
        gap: var(--cd-space-2);
        margin-top: var(--cd-space-2);
      }
    `,
  ];

  protected readonly composant = Banner;
  declare hasActions: boolean;

  constructor() {
    super();
    this.hasActions = false;
  }

  protected override render() {
    const { tone, title, icon = 'info' } = this.data;
    return html`<div part="banner" class="banner ${tone}" role=${tone === 'halt' ? 'alert' : 'status'}>
      <cd-icon class="icon" .data=${{ name: icon, size: 'md' }}></cd-icon>
      <div class="body">
        <p class="title">${title}</p>
        <div class="text"><slot></slot></div>
      </div>
      <div class="actions" ?hidden=${!this.hasActions}>
        <slot name="actions" @slotchange=${(e: Event) => (this.hasActions = isFilled(e.target as HTMLSlotElement))}></slot>
      </div>
    </div>`;
  }
}
