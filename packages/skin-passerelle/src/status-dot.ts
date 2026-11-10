import { StatusDot } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/** `cd-status-dot`: a dot of its tone, haloed when live; its `label` is read by screen readers only. */
export class PasserelleStatusDot extends PasserelleElement<typeof StatusDot> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: inline-flex;
        position: relative;
        flex: none;
      }
      .dot {
        width: var(--cd-dot);
        height: var(--cd-dot);
        border-radius: var(--cd-radius-full);
        background: var(--cd-muted);
      }
      .go {
        background: var(--cd-go);
      }
      .accent {
        background: var(--cd-accent);
      }
      .caution {
        background: var(--cd-caution);
      }
      .halt {
        background: var(--cd-halt);
      }
      .pulse {
        box-shadow: 0 0 0 var(--cd-space-1) var(--cd-accent-soft);
      }
      .go.pulse {
        box-shadow: 0 0 0 var(--cd-space-1) var(--cd-go-soft);
      }
      .halt.pulse {
        box-shadow: 0 0 0 var(--cd-space-1) var(--cd-halt-soft);
      }
      .caution.pulse {
        box-shadow: 0 0 0 var(--cd-space-1) var(--cd-caution-soft);
      }
    `,
  ];

  protected readonly composant = StatusDot;

  protected override render() {
    const { tone, pulse, label } = this.data;
    return html`<span part="dot" class="dot ${tone} ${pulse ? 'pulse' : ''}" aria-hidden="true"></span
      ><span class="visually-hidden">${label}</span>`;
  }
}
