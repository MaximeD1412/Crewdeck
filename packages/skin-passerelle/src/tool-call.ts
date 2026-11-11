import { ToolCall } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/** `cd-tool-call`: one mono line, the tool, what it touched (cut short), what it returned. */
export class PasserelleToolCall extends PasserelleElement<typeof ToolCall> {
  static override styles = [
    sharedStyles,
    css`
      .call {
        display: flex;
        align-items: center;
        gap: var(--cd-space-2);
        min-width: 0;
        padding: var(--cd-space-2) var(--cd-space-3);
        border: thin solid var(--cd-line);
        border-radius: var(--cd-radius);
        background: var(--cd-side);
        color: var(--cd-muted);
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
      }
      cd-icon {
        flex: none;
      }
      .tool {
        color: var(--cd-ink);
        font-weight: 500;
        flex: none;
      }
      code {
        flex: 1;
        min-width: 0;
        font: inherit;
        color: var(--cd-ink-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .detail {
        margin-left: auto;
        white-space: nowrap;
      }
    `,
  ];

  protected readonly composant = ToolCall;

  protected override render() {
    const { tool, target, detail } = this.data;
    return html`<p part="call" class="call">
      <cd-icon .data=${{ name: 'chevron-right', size: 'sm' }}></cd-icon>
      <span class="tool">${tool}</span>
      ${target === null ? nothing : html`<code class="target" title=${target}>${target}</code>`}
      ${detail === null ? nothing : html`<span class="detail">${detail}</span>`}
    </p>`;
  }
}
