import { ProcessTrack, t, type ComposantData, type IconName } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

type State = ComposantData<typeof ProcessTrack>['steps'][number]['state'];

/** The icon in each state's mark; `current` has a dot, `todo` nothing (`design/components.js`, `STEP_ICON`). */
const MARKS: Readonly<Partial<Record<State, IconName>>> = { done: 'check', halt: 'x', off: 'pause' };

/**
 * `cd-process-track`: the Étapes as an ordered list, each a round mark and
 * its label over its meta, joined by a line, green up to the last one done.
 * The current one is `aria-current="step"`; one turned off has a dashed mark
 * and says « désactivée »; the others say their state to screen readers
 * only. `horizontal` lines them up from 1280 px and stacks them below.
 */
export class PasserelleProcessTrack extends PasserelleElement<typeof ProcessTrack> {
  static override styles = [
    sharedStyles,
    css`
      ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
      }
      li {
        position: relative;
        display: grid;
        grid-template-columns: var(--cd-icon-box) minmax(0, 1fr);
        gap: var(--cd-space-3);
        padding-bottom: var(--cd-space-4);
      }
      li:last-child {
        padding-bottom: 0;
      }
      li::before {
        content: '';
        position: absolute;
        left: calc((var(--cd-icon-box) - var(--cd-stroke)) / 2);
        top: var(--cd-icon-box);
        bottom: 0;
        width: var(--cd-stroke);
        background: var(--cd-line-strong);
      }
      li:last-child::before {
        display: none;
      }
      li.done::before {
        background: var(--cd-go);
      }
      .mark {
        width: var(--cd-icon-box);
        height: var(--cd-icon-box);
        border-radius: var(--cd-radius-full);
        border: var(--cd-stroke) solid var(--cd-line-strong);
        display: grid;
        place-items: center;
        color: var(--cd-muted);
        background: var(--cd-panel);
      }
      .done .mark {
        border-color: var(--cd-go);
        background: var(--cd-go-soft);
        color: var(--cd-go);
      }
      .current .mark {
        border-color: var(--cd-accent);
        background: var(--cd-accent-soft);
      }
      .halt .mark {
        border-color: var(--cd-halt);
        background: var(--cd-halt-soft);
        color: var(--cd-halt);
      }
      .off .mark {
        border-style: dashed;
      }
      .pulse {
        width: var(--cd-dot);
        height: var(--cd-dot);
        border-radius: var(--cd-radius-full);
        background: var(--cd-accent);
      }
      .text {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-1);
        padding-top: var(--cd-space-1);
        min-width: 0;
        min-height: var(--cd-icon-box);
      }
      b {
        font: var(--cd-font-title-weight) var(--cd-font-label-size) / var(--cd-font-title-line-height)
          var(--cd-font-title-family), sans-serif;
        color: var(--cd-ink);
      }
      .todo b,
      .off b {
        color: var(--cd-muted);
      }
      .meta,
      .state {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-muted);
      }
      @media (min-width: 1280px) {
        .horizontal {
          flex-direction: row;
          gap: var(--cd-space-3);
        }
        .horizontal li {
          flex: 1 1 0;
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: var(--cd-icon-box) auto;
          gap: var(--cd-space-2);
          padding-bottom: 0;
        }
        .horizontal li::before {
          left: calc(var(--cd-icon-box) + var(--cd-space-2));
          right: var(--cd-space-2);
          top: calc((var(--cd-icon-box) - var(--cd-stroke)) / 2);
          bottom: auto;
          width: auto;
          height: var(--cd-stroke);
        }
        .horizontal .text {
          padding-top: 0;
          min-height: 0;
        }
      }
    `,
  ];

  protected readonly composant = ProcessTrack;

  protected override render() {
    const { direction, steps } = this.data;
    return html`<ol part="track" class=${direction}>
      ${steps.map(({ label, meta, state }) => {
        const icon = MARKS[state];
        return html`<li class=${state} aria-current=${state === 'current' ? 'step' : nothing}>
          <span class="mark" aria-hidden="true">
            ${icon
              ? html`<cd-icon .data=${{ name: icon, size: 'sm' }}></cd-icon>`
              : state === 'current'
                ? html`<span class="pulse"></span>`
                : nothing}
          </span>
          <span class="text">
            <b>${label}</b>
            <span class="state ${state === 'off' ? '' : 'visually-hidden'}">${t(`processTrack.${state}`)}</span>
            ${meta === null ? nothing : html`<span class="meta">${meta}</span>`}
          </span>
        </li>`;
      })}
    </ol>`;
  }
}
