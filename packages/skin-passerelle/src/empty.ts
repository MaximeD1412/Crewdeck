import { Empty } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { isFilled, PasserelleElement, sharedStyles } from './base.js';

/** `cd-empty`: what a list says when it has nothing to show, and what to do then. */
export class PasserelleEmpty extends PasserelleElement<typeof Empty> {
  static override properties = { hasActions: { state: true } };
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: var(--cd-space-2);
        padding: var(--cd-space-10) var(--cd-space-4);
      }
      .icon {
        width: var(--cd-touch);
        height: var(--cd-touch);
        border-radius: var(--cd-radius-lg);
        background: var(--cd-sunk);
        color: var(--cd-muted);
        display: grid;
        place-items: center;
        margin-bottom: var(--cd-space-2);
      }
      .title {
        font: var(--cd-font-title-weight) var(--cd-font-title-size) / var(--cd-font-title-line-height)
          var(--cd-font-title-family), sans-serif;
        color: var(--cd-ink);
      }
      .text {
        color: var(--cd-muted);
        max-width: var(--cd-dialog-width);
        font-size: var(--cd-font-body-sm-size);
        line-height: var(--cd-font-body-sm-line-height);
      }
      .actions {
        margin-top: var(--cd-space-3);
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: var(--cd-space-2);
      }
    `,
  ];

  protected readonly composant = Empty;
  declare hasActions: boolean;

  constructor() {
    super();
    this.hasActions = false;
  }

  protected override render() {
    const { icon, title } = this.data;
    return html`
      <span class="icon"><cd-icon .data=${{ name: icon, size: 'md' }}></cd-icon></span>
      <p class="title" part="title">${title}</p>
      <div class="text"><slot></slot></div>
      <div class="actions" ?hidden=${!this.hasActions}>
        <slot name="actions" @slotchange=${(e: Event) => (this.hasActions = isFilled(e.target as HTMLSlotElement))}></slot>
      </div>
    `;
  }
}
