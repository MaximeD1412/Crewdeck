import { MenuItem } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-menu-item`: a link the router follows. At 390 a tab of the tab bar when
 * `primary` (the Décisions' count as a badge on À toi only), a row with its
 * `meta` in the « Plus » sheet otherwise; at 1280 a link of the sidebar, its
 * count on the right.
 */
export class PasserelleMenuItem extends PasserelleElement<typeof MenuItem> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        min-width: 0;
      }
      a {
        position: relative;
        display: flex;
        color: var(--cd-ink-2);
      }
      a:focus-visible {
        outline-offset: calc(var(--cd-stroke) * -1);
      }
      .label {
        min-width: 0;
      }
      .count,
      .meta,
      .chevron {
        display: none;
      }

      /* 390: a tab */
      .tab {
        height: 100%;
        min-height: var(--cd-touch);
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--cd-space-1);
        color: var(--cd-muted);
        font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
          var(--cd-font-caption-family), sans-serif;
      }
      .tab[aria-current] {
        color: var(--cd-accent-text);
      }
      .tab[aria-current]::before {
        content: '';
        position: absolute;
        top: 0;
        left: 25%;
        right: 25%;
        height: var(--cd-stroke);
        background: var(--cd-accent);
      }
      .tab .badge {
        display: block;
        position: absolute;
        top: var(--cd-space-2);
        left: 55%;
        min-width: var(--cd-space-5);
        height: var(--cd-space-5);
        padding: 0 var(--cd-space-1);
        border-radius: var(--cd-radius-full);
        background: var(--cd-halt);
        color: var(--cd-halt-ink);
        font: 600 var(--cd-font-caption-size) / var(--cd-space-5) var(--cd-font-body-family), sans-serif;
        text-align: center;
      }

      /* 390: a row of the « Plus » sheet */
      .row {
        align-items: center;
        gap: var(--cd-space-3);
        padding: var(--cd-space-3) var(--cd-space-4);
        min-height: var(--cd-touch);
        color: var(--cd-ink);
      }
      .row:hover {
        background: var(--cd-raised);
      }
      .row .box {
        flex: none;
        width: var(--cd-icon-box);
        height: var(--cd-icon-box);
        border-radius: var(--cd-radius);
        display: grid;
        place-items: center;
        background: var(--cd-sunk);
        color: var(--cd-ink-2);
      }
      .row[aria-current] .box {
        background: var(--cd-accent-soft);
        color: var(--cd-accent-text);
      }
      .row .text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-1);
      }
      .row .label {
        font: var(--cd-font-title-weight) var(--cd-font-label-size) / var(--cd-font-title-line-height)
          var(--cd-font-title-family), sans-serif;
      }
      .row[aria-current] .label {
        color: var(--cd-accent-text);
      }
      .row .meta {
        display: block;
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-muted);
      }
      .row .chevron {
        display: inline-flex;
        color: var(--cd-muted);
      }

      @media (min-width: 1280px) {
        /* A link of the sidebar */
        a.tab,
        a.row {
          height: auto;
          min-height: 0;
          flex-direction: row;
          align-items: center;
          justify-content: flex-start;
          gap: var(--cd-space-3);
          padding: var(--cd-space-2) var(--cd-space-3);
          border-radius: var(--cd-radius);
          color: var(--cd-ink-2);
          font: 500 var(--cd-font-label-size) / var(--cd-font-label-line-height) var(--cd-font-label-family), sans-serif;
        }
        a:hover {
          background: var(--cd-raised);
          color: var(--cd-ink);
        }
        a[aria-current] {
          background: var(--cd-accent-soft);
          color: var(--cd-accent-text);
          box-shadow: inset var(--cd-stroke) 0 0 var(--cd-accent);
        }
        a.tab[aria-current]::before {
          content: none;
        }
        a.row .box {
          width: auto;
          height: auto;
          background: none;
          color: inherit;
        }
        a.row .text {
          display: contents;
        }
        a.row .label {
          font: inherit;
          color: inherit;
        }
        a.row .meta,
        a.row .chevron,
        a.tab .badge {
          display: none;
        }
        a .count.side {
          display: block;
          margin-left: auto;
          font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
            var(--cd-font-meta-family), monospace;
          color: var(--cd-muted);
        }
        a[aria-current] .count.side {
          color: var(--cd-accent-text);
        }
      }
    `,
  ];

  protected readonly composant = MenuItem;

  protected override render() {
    const { id, label, icon, href, current, count, meta, primary } = this.data;
    const glyph = html`<cd-icon .data=${{ name: icon, size: 'md' }}></cd-icon>`;
    return html`<a part="link" class=${primary ? 'tab' : 'row'} href=${href} aria-current=${current ? 'page' : nothing}
      >${primary ? glyph : html`<span class="box">${glyph}</span>`}<span class="text"
        ><span class="label">${label}</span>${meta && !primary ? html`<span class="meta">${meta}</span>` : nothing}</span
      >${count === null ? nothing : html`<span class="count side">${count}</span>`}${count !== null && primary && id === 'a-toi'
        ? html`<span class="count badge">${count}</span>`
        : nothing}${primary ? nothing : html`<span class="chevron"><cd-icon .data=${{ name: 'chevron-right', size: 'sm' }}></cd-icon></span>`}</a
    >`;
  }
}
