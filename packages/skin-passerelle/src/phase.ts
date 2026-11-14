import { Phase, t } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-phase`: a `section` named « Phase / <name> », its head (the name, « pour
 * <forEach> » with the accent rail when it repeats, its Manques), then the
 * grid of its Étapes, each cell `--cd-step-card` wide; the cards are its
 * default Emplacement, each given its `grid-column` and `grid-row`. A click
 * on its head emits `select`.
 */
export class PasserellePhase extends PasserelleElement<typeof Phase> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        justify-self: start;
      }
      section {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-4);
        padding: var(--cd-space-3) var(--cd-space-4) var(--cd-space-10);
        background: var(--cd-ground);
        border: thin solid var(--cd-line-strong);
        border-radius: var(--cd-radius-lg);
      }
      .repeated {
        border-top: var(--cd-rail) solid var(--cd-accent);
      }
      .target {
        border-color: var(--cd-accent);
        border-style: dashed;
      }
      .selected {
        outline: var(--cd-stroke) solid var(--cd-accent);
        outline-offset: var(--cd-stroke);
      }
      header {
        display: flex;
        align-items: center;
        gap: var(--cd-space-3);
        min-height: var(--cd-control-sm);
        cursor: pointer;
      }
      h3 {
        margin: 0;
        color: var(--cd-ink);
        font: var(--cd-font-section-label-weight) var(--cd-font-section-label-size) /
            var(--cd-font-section-label-line-height) var(--cd-font-section-label-family),
          sans-serif;
        letter-spacing: var(--cd-font-section-label-letter-spacing);
        text-transform: uppercase;
      }
      .repeat {
        display: inline-flex;
        align-items: center;
        gap: var(--cd-space-1);
        color: var(--cd-accent-text);
        font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
          var(--cd-font-caption-family), sans-serif;
      }
      .grid {
        display: grid;
        grid-auto-columns: var(--cd-step-card);
        gap: var(--cd-space-10) var(--cd-space-5);
        align-items: start;
      }
    `,
  ];

  protected readonly composant = Phase;

  protected override render() {
    const { name, forEach, gaps, target, selected } = this.data;
    const classes = [forEach ? 'repeated' : '', target ? 'target' : '', selected ? 'selected' : ''].join(' ');
    return html`<section part="phase" class=${classes} aria-label=${t('phase.label', { name })}>
      <header part="head" @click=${() => this.emit('select', {})}>
        <h3>${name}</h3>
        ${forEach
          ? html`<span class="repeat"><cd-icon .data=${{ name: 'loop', size: 'sm' }}></cd-icon>${t('phase.forEach', { forEach })}</span>`
          : nothing}
        ${gaps > 0
          ? html`<cd-status-badge
              .data=${{ tone: 'caution', label: t(gaps === 1 ? 'canvas.gaps.one' : 'canvas.gaps.other', { count: gaps }) }}
            ></cd-status-badge>`
          : nothing}
      </header>
      <div class="grid" part="grid"><slot></slot></div>
    </section>`;
  }
}
