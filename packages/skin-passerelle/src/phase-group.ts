import { PhaseGroup, t } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-phase-group`: a Phase on the phone's list of a Process, a native
 * `<details>` named « Phase / {name} ». Its summary holds the name as a
 * section label, its Manques in a `caution` badge, the chevron, then « pour
 * {forEach} · {count} »; its body its `cd-step-row`s. `open` is bound only
 * when it changes: the Pilote's folding stays while the data stays open or
 * folded.
 */
export class PasserellePhaseGroup extends PasserelleElement<typeof PhaseGroup> {
  static override styles = [
    sharedStyles,
    css`
      details {
        background: var(--cd-panel);
        border: thin solid var(--cd-line);
        border-radius: var(--cd-radius-lg);
      }
      summary {
        list-style: none;
        cursor: pointer;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cd-space-1) var(--cd-space-2);
        min-height: var(--cd-touch);
        padding: var(--cd-space-3) var(--cd-space-4);
        border-radius: var(--cd-radius-lg);
      }
      summary::-webkit-details-marker {
        display: none;
      }
      summary:focus-visible {
        outline: var(--cd-stroke) solid var(--cd-accent);
        outline-offset: calc(var(--cd-stroke) * -1);
      }
      .name {
        font: var(--cd-font-section-label-weight) var(--cd-font-section-label-size) /
            var(--cd-font-section-label-line-height) var(--cd-font-section-label-family),
          sans-serif;
        letter-spacing: var(--cd-font-section-label-letter-spacing);
        text-transform: uppercase;
        color: var(--cd-ink);
      }
      .chevron {
        margin-left: auto;
        color: var(--cd-muted);
      }
      details[open] .chevron {
        transform: rotate(180deg);
      }
      .meta {
        flex-basis: 100%;
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-muted);
      }
      .body {
        border-top: thin solid var(--cd-line);
      }
    `,
  ];

  protected readonly composant = PhaseGroup;

  protected override render() {
    const { name, forEach, count, gaps, open } = this.data;
    const meta = [forEach === null ? null : t('phaseGroup.forEach', { forEach }), count].filter(Boolean).join(' · ');
    return html`<details part="group" aria-label=${t('phaseGroup.label', { name })} ?open=${open}>
      <summary>
        <span class="name">${name}</span>
        ${gaps === 0
          ? nothing
          : html`<cd-status-badge
              .data=${{ tone: 'caution', label: t(gaps === 1 ? 'phaseGroup.gaps.one' : 'phaseGroup.gaps.other', { count: gaps }) }}
            ></cd-status-badge>`}
        <cd-icon class="chevron" .data=${{ name: 'chevron-down', size: 'sm' }}></cd-icon>
        <span class="meta">${meta}</span>
      </summary>
      <div class="body"><slot></slot></div>
    </details>`;
  }
}
