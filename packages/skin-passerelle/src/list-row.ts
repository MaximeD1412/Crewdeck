import { ListRow } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-list-row`: a generic row, its icon in a box of its tone, its title and
 * meta, then its `trailing` Emplacement. With `href` the whole row is an `<a>`
 * the router intercepts. A row after another draws the hairline between them.
 */
export class PasserelleListRow extends PasserelleElement<typeof ListRow> {
  static override styles = [
    sharedStyles,
    css`
      .row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: var(--cd-space-3);
        align-items: center;
        padding: var(--cd-space-3) var(--cd-space-4);
        min-height: var(--cd-touch);
        color: var(--cd-ink);
      }
      .row.with-icon {
        grid-template-columns: auto minmax(0, 1fr) auto;
      }
      :host(:not(:first-child)) .row {
        border-top: thin solid var(--cd-line);
      }
      .row:hover {
        background: var(--cd-raised);
      }
      a.row:focus-visible {
        outline-offset: calc(var(--cd-stroke) * -1);
      }
      .icon {
        width: var(--cd-icon-box);
        height: var(--cd-icon-box);
        border-radius: var(--cd-radius);
        display: grid;
        place-items: center;
        background: var(--cd-sunk);
        color: var(--cd-ink-2);
      }
      .halt .icon {
        background: var(--cd-halt-soft);
        color: var(--cd-halt);
      }
      .caution .icon {
        background: var(--cd-caution-soft);
        color: var(--cd-caution);
      }
      .go .icon {
        background: var(--cd-go-soft);
        color: var(--cd-go);
      }
      .accent .icon {
        background: var(--cd-accent-soft);
        color: var(--cd-accent-text);
      }
      .main {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-1);
      }
      .title {
        font: var(--cd-font-title-weight) var(--cd-font-label-size) / var(--cd-font-title-line-height)
          var(--cd-font-title-family), sans-serif;
        color: var(--cd-ink);
        overflow-wrap: anywhere;
      }
      .meta {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-muted);
      }
      .trailing {
        display: flex;
        align-items: center;
        gap: var(--cd-space-2);
        justify-content: flex-end;
        flex-wrap: wrap;
      }
    `,
  ];

  protected readonly composant = ListRow;

  protected override render() {
    const { title, meta, icon, tone, href } = this.data;
    const classes = `row ${icon ? 'with-icon' : ''} ${tone ?? ''}`;
    const content = html`
      ${icon
        ? html`<span class="icon"><cd-icon .data=${{ name: icon, size: 'sm' }}></cd-icon></span>`
        : nothing}
      <span class="main">
        <span class="title">${title}</span>
        ${meta === undefined ? nothing : html`<span class="meta">${meta}</span>`}
      </span>
      <span class="trailing"><slot name="trailing"></slot></span>
    `;
    return href === undefined
      ? html`<div part="row" class=${classes}>${content}</div>`
      : html`<a part="row" class=${classes} href=${href}>${content}</a>`;
  }
}
