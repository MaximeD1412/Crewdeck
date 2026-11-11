import { t, TicketRow, type ComposantData, type Tone } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { isFilled, PasserelleElement, sharedStyles } from './base.js';
import { rowStyles } from './row.js';

type State = ComposantData<typeof TicketRow>['state'];

/** The tone of each state's badge (`design/components.js`, `TICKET`). */
const TONES: Readonly<Record<State, Tone>> = {
  pret: 'neutral',
  'en-cours': 'accent',
  'en-review': 'accent',
  checks: 'accent',
  bloque: 'halt',
  'revue-visuelle': 'caution',
  interrompu: 'caution',
  merge: 'go',
  attente: 'neutral',
};

/**
 * `cd-ticket-row`: a Ticket. `#<number>` in mono, its title, meta and
 * context, then its badge on the right; a rail only when it is blocked or
 * waits for the Pilote. With `href` its title is the link, stretched over the
 * row and named by its number and title; the page's buttons (`actions`) go
 * under it, on the right from 1280 px.
 */
export class PasserelleTicketRow extends PasserelleElement<typeof TicketRow> {
  static override properties = { hasActions: { state: true } };
  static override styles = [
    sharedStyles,
    rowStyles,
    css`
      .row {
        grid-template-columns: var(--cd-rail) auto minmax(0, 1fr) auto;
      }
      .accent .rail,
      .go .rail,
      .neutral .rail {
        background: transparent;
      }
      .number {
        font-weight: 500;
        line-height: var(--cd-font-title-line-height);
        min-width: var(--cd-icon-box);
      }
      .actions {
        grid-column: 3 / -1;
        justify-content: flex-start;
        margin-top: var(--cd-space-2);
      }
      @media (min-width: 1280px) {
        .row {
          grid-template-columns: var(--cd-rail) auto minmax(0, 1fr) auto auto;
        }
        .actions {
          grid-column: auto;
          margin-top: 0;
        }
      }
    `,
  ];

  protected readonly composant = TicketRow;
  declare hasActions: boolean;

  constructor() {
    super();
    this.hasActions = false;
  }

  protected override render() {
    const { number, title, meta, state, label, context, href } = this.data;
    const tone = TONES[state];
    return html`<div part="row" class="row ${tone}">
      <span class="rail"></span>
      <span class="number" aria-hidden=${href === null ? nothing : 'true'}>#${number}</span>
      <div class="main">
        ${href === null
          ? html`<span class="title">${title}</span>`
          : html`<a class="open title" href=${href}><span class="visually-hidden">#${number} </span>${title}</a>`}
        ${meta === null ? nothing : html`<span class="meta">${meta}</span>`}
        ${context === null ? nothing : html`<span class="context">${context}</span>`}
      </div>
      <span class="aside badge">
        <cd-status-badge .data=${{ tone, label: label ?? t(`ticketRow.state.${state}`) }}></cd-status-badge>
      </span>
      <div class="aside actions over" ?hidden=${!this.hasActions}>
        <slot name="actions" @slotchange=${(e: Event) => (this.hasActions = isFilled(e.target as HTMLSlotElement))}></slot>
      </div>
    </div>`;
  }
}
