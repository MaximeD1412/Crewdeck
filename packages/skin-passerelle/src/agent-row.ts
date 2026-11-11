import { AgentRow } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-agent-row`: a running Session, one button over the whole row. A dot of
 * its tone, haloed while it runs; `<b>Projet</b> · Ticket`; then its Étape in
 * a chip (`go` tinted as `accent`, as in the mockups), its Moteur and since
 * when, in mono.
 */
export class PasserelleAgentRow extends PasserelleElement<typeof AgentRow> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }
      :host(:not(:first-child)) .row {
        border-top: thin solid var(--cd-line);
      }
      .row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 0 var(--cd-space-3);
        align-items: start;
        width: 100%;
        padding: var(--cd-space-3) var(--cd-space-4);
        border: 0;
        background: transparent;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }
      .row:hover {
        background: var(--cd-raised);
      }
      .row:focus-visible {
        outline: var(--cd-stroke) solid var(--cd-accent);
        outline-offset: calc(var(--cd-stroke) * -1);
      }
      .dot {
        width: var(--cd-dot);
        height: var(--cd-dot);
        margin-top: var(--cd-space-2);
        border-radius: var(--cd-radius-full);
      }
      .go.dot {
        background: var(--cd-go);
        box-shadow: 0 0 0 var(--cd-space-1) var(--cd-go-soft);
      }
      .accent.dot {
        background: var(--cd-accent);
      }
      .caution.dot {
        background: var(--cd-caution);
      }
      .halt.dot {
        background: var(--cd-halt);
      }
      .main {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-1);
        min-width: 0;
      }
      .title {
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
        color: var(--cd-ink-2);
      }
      .title b {
        color: var(--cd-ink);
        font-weight: 600;
      }
      /* One line: the Étape whole, the Moteur and since when cut short when they must be. */
      .meta {
        display: flex;
        align-items: center;
        min-width: 0;
        gap: var(--cd-space-2);
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-muted);
      }
      .engine {
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .step {
        flex: none;
        white-space: nowrap;
        padding: 0 var(--cd-space-2);
        border-radius: var(--cd-radius-sm);
        font-weight: 500;
      }
      .go.step,
      .accent.step {
        background: var(--cd-accent-soft);
        color: var(--cd-accent-text);
      }
      .caution.step {
        background: var(--cd-caution-soft);
        color: var(--cd-caution);
      }
      .halt.step {
        background: var(--cd-halt-soft);
        color: var(--cd-halt);
      }
    `,
  ];

  protected readonly composant = AgentRow;

  protected override render() {
    const { sessionId, projet, ticket, step, engine, since, tone } = this.data;
    return html`<button part="row" type="button" class="row" @click=${() => this.emit('open', { sessionId })}>
      <span class="dot ${tone}" aria-hidden="true"></span>
      <span class="main">
        <span class="title"><b>${projet}</b> · ${ticket}</span>
        <span class="meta"><span class="step ${tone}">${step}</span> <span class="engine">${engine} · ${since}</span></span>
      </span>
    </button>`;
  }
}
