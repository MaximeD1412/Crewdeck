import { PageHeader } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/** `cd-page-header`: a page's `header`, its back link, its only `h1`, its count and its actions. */
export class PasserellePageHeader extends PasserelleElement<typeof PageHeader> {
  static override styles = [
    sharedStyles,
    css`
      header {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
      }
      .back {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: var(--cd-space-1);
        align-self: flex-start;
        min-height: var(--cd-touch);
        color: var(--cd-muted);
        font: var(--cd-font-label-weight) var(--cd-font-body-sm-size) / var(--cd-font-label-line-height)
          var(--cd-font-label-family), sans-serif;
      }
      .back:hover {
        color: var(--cd-ink);
      }
      .row {
        display: flex;
        align-items: center;
        gap: var(--cd-space-3);
        flex-wrap: wrap;
      }
      .titles {
        display: flex;
        align-items: baseline;
        gap: var(--cd-space-3);
        margin-right: auto;
        min-width: 0;
        flex-wrap: wrap;
      }
      h1 {
        font: var(--cd-font-page-title-weight) var(--cd-font-page-title-size) / var(--cd-font-page-title-line-height)
          var(--cd-font-page-title-family), sans-serif;
        letter-spacing: var(--cd-font-page-title-letter-spacing);
        color: var(--cd-ink);
      }
      .count {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-muted);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cd-space-2);
        align-items: center;
      }
    `,
  ];

  protected readonly composant = PageHeader;

  protected override render() {
    const { title, count, back } = this.data;
    return html`<header part="header">
      ${back
        ? html`<a class="back" href=${back.href}><cd-icon .data=${{ name: 'arrow-left', size: 'sm' }}></cd-icon>${back.label}</a>`
        : nothing}
      <div class="row">
        <div class="titles">
          <h1>${title}</h1>
          ${count === undefined ? nothing : html`<span class="count">${count}</span>`}
        </div>
        <div class="actions"><slot name="actions"></slot></div>
      </div>
    </header>`;
  }
}
