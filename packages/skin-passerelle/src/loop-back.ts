import { LoopBack, t } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/** `cd-loop-back`: a Retour's badge, « Retour · 3 fois au plus », in caution (in accent when active). */
export class PasserelleLoopBack extends PasserelleElement<typeof LoopBack> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: inline-flex;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: var(--cd-space-1);
        white-space: nowrap;
        padding: 0 var(--cd-space-2);
        border: thin solid var(--cd-caution);
        border-radius: var(--cd-radius);
        background: var(--cd-caution-soft);
        color: var(--cd-caution);
        font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
          var(--cd-font-caption-family), sans-serif;
      }
      .active {
        border-color: var(--cd-accent);
        background: var(--cd-accent-soft);
        color: var(--cd-accent-text);
      }
    `,
  ];

  protected readonly composant = LoopBack;

  protected override render() {
    const { max, state } = this.data;
    return html`<span part="badge" class="badge ${state ?? ''}">
      <cd-icon .data=${{ name: 'undo', size: 'sm' }}></cd-icon>${t('loopBack.label', { max })}
    </span>`;
  }
}
