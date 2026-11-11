import { DecisionRow } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';
import { rowStyles } from './row.js';

/**
 * `cd-decision-row`: a Décision. Its rail and its icon box in its tone, its
 * kind before its title, its signals (`badges`) beside it, its meta and its
 * context. Its title is the button that opens it, stretched over the row; the
 * page's buttons (`actions`) stay pressable on their own, on the right from
 * 1280 px. Narrower, they wait in the opened Décision and a chevron says the
 * row opens.
 */
export class PasserelleDecisionRow extends PasserelleElement<typeof DecisionRow> {
  static override styles = [
    sharedStyles,
    rowStyles,
    css`
      .row {
        grid-template-columns: var(--cd-rail) var(--cd-icon-box) minmax(0, 1fr) auto;
      }
      .kind {
        color: var(--cd-muted);
        font-weight: 500;
      }
      .context {
        -webkit-line-clamp: 1;
      }
      .actions {
        display: none;
      }
      .chevron {
        align-self: center;
        color: var(--cd-muted);
      }
      @media (min-width: 1280px) {
        .actions {
          display: flex;
        }
        .context {
          -webkit-line-clamp: 2;
        }
        .chevron {
          display: none;
        }
      }
    `,
  ];

  protected readonly composant = DecisionRow;

  protected override render() {
    const { id, kind, title, meta, context, tone, icon } = this.data;
    return html`<div part="row" class="row ${tone}">
      <span class="rail"></span>
      <span class="icon"><cd-icon .data=${{ name: icon, size: 'sm' }}></cd-icon></span>
      <div class="main">
        <div class="title-line">
          <button type="button" class="open title" @click=${() => this.emit('open', { id })}>
            <span class="kind">${kind} · </span>${title}
          </button>
          <slot name="badges"></slot>
        </div>
        <span class="meta">${meta}</span>
        ${context === null ? nothing : html`<span class="context">${context}</span>`}
      </div>
      <div class="aside actions over"><slot name="actions"></slot></div>
      <cd-icon class="chevron" .data=${{ name: 'chevron-right', size: 'sm' }}></cd-icon>
    </div>`;
  }
}
