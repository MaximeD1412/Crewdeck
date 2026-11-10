import { KeyValue } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/** `cd-key-value`: facts as a `<dl>`, labels muted, machine values in mono. */
export class PasserelleKeyValue extends PasserelleElement<typeof KeyValue> {
  static override styles = [
    sharedStyles,
    css`
      dl {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: var(--cd-space-2) var(--cd-space-4);
        margin: 0;
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
      }
      dt {
        color: var(--cd-muted);
      }
      dd {
        margin: 0;
        color: var(--cd-ink);
        overflow-wrap: anywhere;
      }
      .mono {
        font: var(--cd-font-mono-weight) var(--cd-font-mono-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-mono-family), monospace;
      }
    `,
  ];

  protected readonly composant = KeyValue;

  protected override render() {
    return html`<dl part="list">
      ${this.data.items.map(
        (item) => html`<dt>${item.label}</dt><dd class=${item.mono ? 'mono' : ''}>${item.value}</dd>`,
      )}
    </dl>`;
  }
}
