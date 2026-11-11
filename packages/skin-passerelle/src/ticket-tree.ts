import { t, TicketTree } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';
import { TICKET_TONES } from './ticket-row.js';

/**
 * `cd-ticket-tree`: the open Tickets as a list, each indented by its depth
 * (`aria-level`) with a guide per level, `#<number>` in mono, its title and
 * what blocks it, its state's badge on the right. The critical path is in
 * bold, said to screen readers, and explained under the list.
 */
export class PasserelleTicketTree extends PasserelleElement<typeof TicketTree> {
  static override styles = [
    sharedStyles,
    css`
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
      }
      li {
        display: grid;
        grid-template-columns: auto auto minmax(0, 1fr) auto;
        gap: var(--cd-space-2);
        align-items: center;
        padding: var(--cd-space-2) 0;
        border-top: thin solid var(--cd-line);
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
      }
      li:first-child {
        border-top: 0;
      }
      .indent {
        display: flex;
        align-self: stretch;
      }
      .indent i {
        width: var(--cd-space-5);
        margin-left: var(--cd-space-2);
        border-left: thin solid var(--cd-line-strong);
      }
      .indent i:last-child {
        height: var(--cd-space-3);
        border-bottom: thin solid var(--cd-line-strong);
      }
      .number {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        font-variant-numeric: tabular-nums;
        color: var(--cd-accent-text);
      }
      .title {
        display: flex;
        flex-direction: column;
        min-width: 0;
        color: var(--cd-ink);
      }
      .title a {
        color: inherit;
      }
      .title a:hover {
        color: var(--cd-accent-hover);
      }
      .critical .name {
        font-weight: 600;
      }
      .blocked {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-halt);
      }
      .caption {
        margin: var(--cd-space-3) 0 0;
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
        color: var(--cd-muted);
      }
    `,
  ];

  protected readonly composant = TicketTree;

  protected override render() {
    const { nodes } = this.data;
    return html`<ul part="tree">
        ${nodes.map(
          ({ number, title, state, depth, blockedBy, critical, href }) => html`<li
            class=${critical ? 'critical' : ''}
            aria-level=${depth + 1}
          >
            <span class="indent" aria-hidden="true">${Array.from({ length: depth }, () => html`<i></i>`)}</span>
            <span class="number">#${number}</span>
            <span class="title">
              ${href === null ? html`<span class="name">${title}</span>` : html`<a class="name" href=${href}>${title}</a>`}
              ${critical ? html`<span class="visually-hidden">${t('ticketTree.critical')}</span>` : nothing}
              ${blockedBy === null ? nothing : html`<small class="blocked">${t('ticketTree.blockedBy', { ticket: blockedBy })}</small>`}
            </span>
            <cd-status-badge .data=${{ tone: TICKET_TONES[state], label: t(`ticketRow.state.${state}`) }}></cd-status-badge>
          </li>`,
        )}
      </ul>
      ${nodes.some((node) => node.critical) ? html`<p class="caption">${t('ticketTree.criticalCaption')}</p>` : nothing}`;
  }
}
