import { Tabs } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

const MOVES: Readonly<Record<string, (index: number, count: number) => number>> = {
  ArrowRight: (i, n) => (i + 1) % n,
  ArrowLeft: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_i, n) => n - 1,
};

/**
 * `cd-tabs`: a WAI-ARIA tablist. A click or an arrow key (Home, End too)
 * selects a tab, that is emits `select`; the focus follows; only the selected
 * tab is in the tab order.
 */
export class PasserelleTabs extends PasserelleElement<typeof Tabs> {
  static override styles = [
    sharedStyles,
    css`
      [role='tablist'] {
        display: flex;
        gap: var(--cd-space-1);
        border-bottom: thin solid var(--cd-line);
        overflow-x: auto;
        scrollbar-width: none;
      }
      button {
        display: inline-flex;
        align-items: center;
        gap: var(--cd-space-2);
        min-height: var(--cd-touch);
        padding: 0 var(--cd-space-3);
        color: var(--cd-muted);
        font: var(--cd-font-label-weight) var(--cd-font-label-size) / var(--cd-font-label-line-height)
          var(--cd-font-label-family), sans-serif;
        border-bottom: var(--cd-stroke) solid transparent;
        white-space: nowrap;
      }
      button:focus-visible {
        outline-offset: calc(var(--cd-stroke) * -1);
      }
      button:hover,
      button[aria-selected='true'] {
        color: var(--cd-ink);
      }
      button[aria-selected='true'] {
        border-bottom-color: var(--cd-accent);
      }
      .count {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-muted);
      }
    `,
  ];

  protected readonly composant = Tabs;

  private onKeydown(event: KeyboardEvent, index: number) {
    const move = MOVES[event.key];
    if (!move) return;
    event.preventDefault();
    const next = move(index, this.data.tabs.length);
    this.shadowRoot?.querySelectorAll('button')[next]?.focus();
    const tab = this.data.tabs[next];
    if (tab) this.emit('select', { id: tab.id });
  }

  protected override render() {
    const tabs = this.data.tabs;
    const selected = Math.max(
      0,
      tabs.findIndex((tab) => tab.selected),
    );
    return html`<div part="tabs" role="tablist">
      ${tabs.map(
        (tab, index) =>
          html`<button
            type="button"
            role="tab"
            aria-selected=${tab.selected ? 'true' : 'false'}
            tabindex=${index === selected ? 0 : -1}
            @click=${() => this.emit('select', { id: tab.id })}
            @keydown=${(event: KeyboardEvent) => this.onKeydown(event, index)}
          >
            ${tab.label}${tab.count === undefined ? nothing : html`<span class="count">${tab.count}</span>`}
          </button>`,
      )}
    </div>`;
  }
}
