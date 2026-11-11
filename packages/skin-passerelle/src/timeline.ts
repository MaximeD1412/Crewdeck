import { t, Timeline, type ComposantData } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { PasserelleElement, sharedStyles } from './base.js';

type Row = ComposantData<typeof Timeline>['rows'][number];

/**
 * `cd-timeline`: the weeks of a planning, the current one marked, then one
 * row per milestone, its bar from its start week over its span on a track of
 * as many columns as weeks. From 1280 px the label is beside the bar and the
 * progress in it; below, each row is a line (label, detail, progress) above
 * its bar. Every row says its period to screen readers.
 */
export class PasserelleTimeline extends PasserelleElement<typeof Timeline> {
  static override styles = [
    sharedStyles,
    css`
      .timeline {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
      }
      .head,
      li {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--cd-space-1) var(--cd-space-3);
        align-items: center;
      }
      .head > :first-child {
        display: none;
      }
      .weeks,
      .track {
        display: grid;
        grid-template-columns: repeat(var(--weeks), minmax(0, 1fr));
      }
      .weeks {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        font-variant-numeric: tabular-nums;
        color: var(--cd-muted);
      }
      .weeks span {
        text-align: center;
      }
      .weeks [aria-current] {
        color: var(--cd-accent-text);
        font-weight: 500;
      }
      ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-3);
      }
      li {
        position: relative;
      }
      .line {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--cd-space-3);
        min-width: 0;
      }
      .label {
        display: flex;
        flex-direction: column;
        min-width: 0;
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
      }
      .label b {
        color: var(--cd-ink);
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .label small,
      .meta {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        font-variant-numeric: tabular-nums;
        color: var(--cd-muted);
      }
      .line .meta {
        flex: none;
      }
      .track {
        height: var(--cd-control-sm);
        align-items: center;
        background: var(--cd-side);
        border-radius: var(--cd-radius);
      }
      .today,
      .bar {
        grid-row: 1;
      }
      .today {
        align-self: stretch;
        background: var(--cd-sunk);
        border-inline: thin dashed var(--cd-accent);
      }
      .bar {
        position: relative;
        height: var(--cd-space-5);
        border-radius: var(--cd-radius-sm);
        background: var(--cd-accent-soft);
        border: thin solid var(--cd-accent);
        color: var(--cd-accent-text);
        padding: 0 var(--cd-space-2);
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .bar .meta {
        display: none;
        color: inherit;
        font-weight: 500;
        line-height: var(--cd-space-5);
      }
      .bar.go {
        background: var(--cd-go-soft);
        border-color: var(--cd-go);
        color: var(--cd-go);
      }
      .bar.caution {
        background: var(--cd-caution-soft);
        border-color: var(--cd-caution);
        color: var(--cd-caution);
      }
      .bar.halt {
        background: var(--cd-halt-soft);
        border-color: var(--cd-halt);
        color: var(--cd-halt);
      }
      .bar.neutral {
        background: var(--cd-sunk);
        border-color: var(--cd-line-strong);
        color: var(--cd-ink-2);
      }
      @media (min-width: 1280px) {
        .head,
        li {
          grid-template-columns: var(--cd-aside-width) minmax(0, 1fr);
        }
        .head > :first-child {
          display: block;
        }
        .line .meta {
          display: none;
        }
        .bar .meta {
          display: inline;
        }
      }
    `,
  ];

  protected readonly composant = Timeline;

  private period({ start, span }: Row): string {
    const { weeks } = this.data;
    const from = weeks[start] ?? '';
    return span === 1 ? from : t('timeline.period', { from, to: weeks[start + span - 1] ?? '' });
  }

  protected override render() {
    const { weeks, today, rows } = this.data;
    const hasToday = today >= 0 && today < weeks.length;
    const todayMarker = hasToday ? html`<span class="today" style=${styleMap({ gridColumn: `${today + 1}` })}></span>` : nothing;
    const meta = (row: Row) => (row.meta === null ? nothing : html`<span class="meta">${row.meta}</span>`);
    return html`<div class="timeline" part="timeline" style=${styleMap({ '--weeks': `${weeks.length}` })}>
      <div class="head">
        <span></span>
        <div class="weeks">
          ${weeks.map(
            (week, index) =>
              html`<span aria-current=${index === today ? 'date' : nothing} title=${index === today ? t('timeline.today') : nothing}
                >${week}</span
              >`,
          )}
        </div>
      </div>
      <ol class="rows">
        ${rows.map(
          (row) => html`<li>
            <div class="line">
              <span class="label"><b>${row.label}</b>${row.detail === null ? nothing : html`<small>${row.detail}</small>`}</span>
              ${meta(row)}
            </div>
            <div class="track" aria-hidden="true">
              ${todayMarker}
              <span class="bar ${row.tone}" style=${styleMap({ gridColumn: `${row.start + 1} / span ${row.span}` })}
                >${meta(row)}</span
              >
            </div>
            <span class="period visually-hidden">${this.period(row)}</span>
          </li>`,
        )}
      </ol>
    </div>`;
  }
}
