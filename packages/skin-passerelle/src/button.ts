import { Button } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-button`: a native `<button>`. Disabled or loading, it is `disabled`
 * (neither focusable nor pressable) and its host swallows clicks; disabled, its
 * reason is beside it and describes it; loading, a spinner takes its icon's
 * place, or covers its label, so its width does not move.
 */
export class PasserelleButton extends PasserelleElement<typeof Button> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--cd-space-2);
        vertical-align: middle;
      }
      button {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--cd-space-2);
        height: var(--cd-touch);
        padding: 0 var(--cd-space-4);
        border-radius: var(--cd-radius);
        border: thin solid transparent;
        white-space: nowrap;
        font: var(--cd-font-label-weight) var(--cd-font-label-size) / var(--cd-font-label-line-height)
          var(--cd-font-label-family), sans-serif;
      }
      .sm {
        height: var(--cd-control-sm);
        padding: 0 var(--cd-space-3);
      }
      .sm::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        top: 50%;
        height: var(--cd-touch);
        transform: translateY(-50%);
      }
      .primary {
        background: var(--cd-accent);
        color: var(--cd-accent-ink);
      }
      .primary:hover:enabled {
        background: var(--cd-accent-hover);
      }
      .primary:active:enabled {
        background: var(--cd-accent-pressed);
      }
      .secondary {
        background: var(--cd-sunk);
        color: var(--cd-ink);
        border-color: var(--cd-line-strong);
      }
      .secondary:hover:enabled {
        background: var(--cd-raised);
      }
      .ghost {
        color: var(--cd-ink-2);
      }
      .ghost:hover:enabled {
        background: var(--cd-raised);
        color: var(--cd-ink);
      }
      .danger {
        color: var(--cd-halt);
        border-color: var(--cd-halt-soft);
        background: var(--cd-halt-soft);
      }
      .danger:hover:enabled {
        border-color: var(--cd-halt);
      }
      button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      button.loading {
        opacity: 0.8;
        cursor: progress;
      }
      .spinner {
        width: var(--cd-icon-sm);
        height: var(--cd-icon-sm);
        border-radius: var(--cd-radius-full);
        border: var(--cd-stroke) solid currentColor;
        border-right-color: transparent;
        flex: none;
      }
      @media (prefers-reduced-motion: no-preference) {
        .spinner {
          animation: spin 0.8s linear infinite;
        }
      }
      @keyframes spin {
        to {
          transform: rotate(1turn);
        }
      }
      .covered .label {
        color: transparent;
      }
      .covered .spinner {
        position: absolute;
        inset: 0;
        margin: auto;
      }
      .reason {
        color: var(--cd-muted);
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
      }
    `,
  ];

  protected readonly composant = Button;

  constructor() {
    super();
    // A disabled control presses nothing, not even through its host or its reason.
    this.addEventListener(
      'click',
      (event) => {
        if (this.data?.state) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      { capture: true },
    );
  }

  protected override render() {
    const { label, variant, size, icon, state, disabledReason } = this.data;
    const loading = state === 'loading';
    const reason = state === 'disabled' && disabledReason ? disabledReason : undefined;
    const classes = [variant, size, loading ? 'loading' : '', loading && !icon ? 'covered' : ''].join(' ');
    return html`
      <button
        part="button"
        type="button"
        class=${classes}
        ?disabled=${state !== undefined}
        aria-busy=${loading ? 'true' : nothing}
        aria-describedby=${reason ? 'reason' : nothing}
      >
        ${loading
          ? html`<span class="spinner" aria-hidden="true"></span>`
          : icon
            ? html`<cd-icon .data=${{ name: icon, size: 'sm' }}></cd-icon>`
            : nothing}
        <span class="label">${label}</span>
      </button>
      ${reason ? html`<span id="reason" class="reason" part="reason">${reason}</span>` : nothing}
    `;
  }
}
