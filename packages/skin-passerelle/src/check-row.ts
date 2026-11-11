import { CheckRow, t, type ComposantData, type IconName } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

type State = ComposantData<typeof CheckRow>['state'];

/** Each state's tone and the icon in its mark; `running` turns instead (`design/components.js`, `CHECK`). */
const STATES: Readonly<Record<State, readonly ['go' | 'halt' | 'accent', IconName | null]>> = {
  passed: ['go', 'check'],
  failed: ['halt', 'x'],
  running: ['accent', null],
};

/**
 * `cd-check-row`: a check of a PR, a round mark of its state's tone, its
 * name (a link to its log with `href`), its state said to screen readers,
 * then its detail in mono on the right.
 */
export class PasserelleCheckRow extends PasserelleElement<typeof CheckRow> {
  static override styles = [
    sharedStyles,
    css`
      .check {
        display: grid;
        grid-template-columns: auto auto minmax(0, 1fr);
        gap: var(--cd-space-3);
        align-items: center;
        padding: var(--cd-space-2) 0;
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
      }
      .mark {
        width: var(--cd-icon-box);
        height: var(--cd-icon-box);
        border-radius: var(--cd-radius-full);
        display: grid;
        place-items: center;
      }
      .go .mark {
        background: var(--cd-go-soft);
        color: var(--cd-go);
      }
      .halt .mark {
        background: var(--cd-halt-soft);
        color: var(--cd-halt);
      }
      .accent .mark {
        background: var(--cd-accent-soft);
        color: var(--cd-accent-text);
      }
      .spinner {
        width: var(--cd-icon-sm);
        height: var(--cd-icon-sm);
        border-radius: var(--cd-radius-full);
        border: var(--cd-stroke) solid currentColor;
        border-right-color: transparent;
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
      .name {
        font-weight: 600;
        color: var(--cd-ink);
      }
      a.name {
        color: var(--cd-accent-text);
      }
      a.name:hover {
        color: var(--cd-accent-hover);
      }
      .detail {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        font-variant-numeric: tabular-nums;
        color: var(--cd-muted);
        text-align: right;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `,
  ];

  protected readonly composant = CheckRow;

  protected override render() {
    const { name, state, detail, href } = this.data;
    const [tone, icon] = STATES[state];
    return html`<div class="check ${tone}" part="check">
      <span class="mark" aria-hidden="true">
        ${icon === null ? html`<span class="spinner"></span>` : html`<cd-icon .data=${{ name: icon, size: 'sm' }}></cd-icon>`}
      </span>
      <span>
        ${href === null ? html`<b class="name">${name}</b>` : html`<a class="name" href=${href}>${name}</a>`}
        <span class="state visually-hidden">${t(`checkRow.state.${state}`)}</span>
      </span>
      ${detail === null ? nothing : html`<span class="detail">${detail}</span>`}
    </div>`;
  }
}
