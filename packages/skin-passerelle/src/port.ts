import { Port, t, type PortType } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/** The slug of each type's colour token, `--cd-type-<slug>`. */
export const TYPE_SLUG: Readonly<Record<PortType, string>> = {
  idea: 'idee',
  prd: 'prd',
  mockups: 'maquettes',
  'technical-design': 'conception',
  inventory: 'inventaire',
  ticket: 'ticket',
  'code-change': 'changement',
  verdict: 'verdict',
  delivery: 'livraison',
};

/**
 * `cd-port`: one row of its card, the type then the note; its dot sits on the
 * card's edge (left for an Entrée, hollow; right for a Sortie, filled), in
 * `--cd-type-<slug>`. The canvas measures its host to anchor the arrows.
 */
export class PasserellePort extends PasserelleElement<typeof Port> {
  static override styles = [
    sharedStyles,
    css`
      .port {
        --type: var(--cd-control-border);
        display: flex;
        align-items: center;
        gap: var(--cd-space-2);
        min-height: var(--cd-port-row);
        color: var(--cd-ink-2);
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
      }
      .in {
        padding-right: var(--cd-space-3);
      }
      .out {
        justify-content: flex-end;
        text-align: right;
        padding-left: var(--cd-space-3);
      }
      .label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: var(--port-label-wrap, nowrap);
      }
      .note {
        color: var(--cd-muted);
      }
      .dot {
        flex: none;
        width: var(--cd-dot);
        height: var(--cd-dot);
        box-sizing: content-box;
        border-radius: var(--cd-radius-full);
        border: var(--cd-stroke) solid var(--type);
        background: var(--cd-panel);
      }
      .in .dot {
        margin-left: calc((var(--cd-dot) / -2) - var(--cd-stroke));
      }
      .out .dot {
        margin-right: calc((var(--cd-dot) / -2) - var(--cd-stroke));
        background: var(--type);
      }
      .unfed {
        color: var(--cd-caution);
      }
      .unfed .dot {
        border-color: var(--cd-caution);
      }
      .active {
        color: var(--cd-ink);
      }
      .active .dot {
        box-shadow:
          0 0 0 var(--cd-stroke) var(--cd-panel),
          0 0 0 var(--cd-rail) var(--type);
      }
      .compatible {
        color: var(--cd-accent-text);
      }
      .compatible .dot {
        border-color: var(--cd-accent);
        box-shadow: 0 0 0 var(--cd-space-1) var(--cd-accent-soft);
      }
      .refused {
        color: var(--cd-halt);
      }
      .refused .dot {
        border-color: var(--cd-halt);
        box-shadow: 0 0 0 var(--cd-space-1) var(--cd-halt-soft);
      }
    `,
  ];

  protected readonly composant = Port;

  protected override render() {
    const { dir, type, label, note, state } = this.data;
    const dot = html`<i class="dot" part="dot" aria-hidden="true"></i>`;
    const text = html`<span class="label"
      >${label}${note ? html` <span class="note">${note}</span>` : nothing}${state === 'unfed'
        ? html`<span class="visually-hidden">, ${t('port.unfed')}</span>`
        : nothing}</span
    >`;
    return html`<div part="port" class="port ${dir} ${state ?? ''}" style="--type: var(--cd-type-${TYPE_SLUG[type]})">
      ${dir === 'in' ? [dot, text] : [text, dot]}
    </div>`;
  }
}
