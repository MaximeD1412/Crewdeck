import { formatPercent, UsageMeter, type ComposantData } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { PasserelleElement, sharedStyles } from './base.js';

type Data = ComposantData<typeof UsageMeter>;

/** The view's tone, else `halt` at 100, `caution` from 80, `accent` below. */
const toneOf = ({ tone, value }: Data): NonNullable<Data['tone']> =>
  tone ?? (value >= 100 ? 'halt' : value >= 80 ? 'caution' : 'accent');

/**
 * `cd-usage-meter`: a limit of a Compte IA, its label and its value with when
 * it resets, then the bar (`role="meter"`, `--cd-bar` high) with a tick at its
 * `mark`, then where the current pace leads.
 */
export class PasserelleUsageMeter extends PasserelleElement<typeof UsageMeter> {
  static override styles = [
    sharedStyles,
    css`
      .meter {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-1);
      }
      .head {
        display: flex;
        justify-content: space-between;
        gap: var(--cd-space-3);
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
        color: var(--cd-ink-2);
      }
      .value {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-meta-family), monospace;
        font-variant-numeric: tabular-nums;
        color: var(--cd-muted);
        white-space: nowrap;
      }
      .track {
        position: relative;
        height: var(--cd-bar);
        border-radius: var(--cd-radius-full);
        background: var(--cd-sunk);
      }
      .fill {
        display: block;
        height: 100%;
        border-radius: var(--cd-radius-full);
        background: var(--cd-accent);
      }
      .fill.caution {
        background: var(--cd-caution);
      }
      .fill.halt {
        background: var(--cd-halt);
      }
      .mark {
        position: absolute;
        top: calc(var(--cd-space-1) * -1);
        bottom: calc(var(--cd-space-1) * -1);
        width: var(--cd-stroke);
        background: var(--cd-ink-2);
      }
      .projection {
        font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
          var(--cd-font-caption-family), sans-serif;
        color: var(--cd-muted);
      }
    `,
  ];

  protected readonly composant = UsageMeter;

  protected override render() {
    const { label, value, detail, projection, mark } = this.data;
    const shown = detail === null ? formatPercent(value / 100) : `${formatPercent(value / 100)} · ${detail}`;
    return html`<div class="meter" part="meter">
      <div class="head"><span>${label}</span><span class="value">${shown}</span></div>
      <div
        class="track"
        role="meter"
        aria-label=${label}
        aria-valuenow=${value}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuetext=${shown}
      >
        <i class="fill ${toneOf(this.data)}" style=${styleMap({ width: `${value}%` })}></i>
        ${mark === undefined
          ? nothing
          : html`<i class="mark" aria-hidden="true" style=${styleMap({ left: `min(${mark}%, 100% - var(--cd-stroke))` })}></i>`}
      </div>
      ${projection === null ? nothing : html`<p class="projection">${projection}</p>`}
    </div>`;
  }
}
