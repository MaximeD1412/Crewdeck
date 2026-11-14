import { t, ToolChip, type IconName } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

const ICON = { role: 'user', skill: 'spark', mcp: 'layers', command: 'terminal', connector: 'plug' } as const satisfies Record<
  string,
  IconName
>;

/** `cd-tool-chip`: an Outil, its kind's icon then its name; the kind's name for screen readers. */
export class PasserelleToolChip extends PasserelleElement<typeof ToolChip> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: inline-flex;
        max-width: 100%;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: var(--cd-space-1);
        max-width: 100%;
        padding: 0 var(--cd-space-1);
        border-radius: var(--cd-radius-sm);
        background: var(--cd-sunk);
        color: var(--cd-ink-2);
        font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
          var(--cd-font-caption-family), sans-serif;
      }
      cd-icon {
        flex: none;
        color: var(--cd-muted);
      }
      .mcp cd-icon,
      .connector cd-icon {
        color: var(--cd-accent-text);
      }
      .name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--cd-font-meta-family), monospace;
      }
    `,
  ];

  protected readonly composant = ToolChip;

  protected override render() {
    const { kind, label } = this.data;
    const kindName = t(`toolChip.kind.${kind}` as const);
    return html`<span part="chip" class="chip ${kind}" title=${kindName}>
      <cd-icon .data=${{ name: ICON[kind], size: 'sm' }}></cd-icon>
      <span class="visually-hidden">${kindName} </span><span class="name">${label}</span>
    </span>`;
  }
}
