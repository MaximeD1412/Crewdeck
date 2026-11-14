import { StepRow, t } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-step-row`: an Étape on the phone's list of a Process. Its icon in a
 * box (`alert` in `caution` when it has a Manque), « {name} · {kindLabel} »
 * (the kind left out when it is the name), its Outils, its flow in mono, its
 * Retour with the `undo` icon, its Manque in `caution`. A hairline above it
 * when another row precedes it.
 */
export class PasserelleStepRow extends PasserelleElement<typeof StepRow> {
  static override styles = [
    sharedStyles,
    css`
      .row {
        display: grid;
        grid-template-columns: var(--cd-icon-box) minmax(0, 1fr);
        gap: var(--cd-space-3);
        align-items: start;
        padding: var(--cd-space-3) var(--cd-space-4);
      }
      :host(:not(:first-child)) .row {
        border-top: thin solid var(--cd-line);
      }
      .icon {
        width: var(--cd-icon-box);
        height: var(--cd-icon-box);
        border-radius: var(--cd-radius);
        display: grid;
        place-items: center;
        background: var(--cd-sunk);
        color: var(--cd-ink-2);
      }
      .gapped .icon {
        background: var(--cd-caution-soft);
        color: var(--cd-caution);
      }
      .main {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-1);
      }
      .title {
        font: var(--cd-font-title-weight) var(--cd-font-label-size) / var(--cd-font-title-line-height)
          var(--cd-font-title-family), sans-serif;
        color: var(--cd-ink);
        overflow-wrap: anywhere;
      }
      .kind {
        color: var(--cd-muted);
        font-weight: 500;
      }
      .tools,
      .flow {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        overflow-wrap: anywhere;
      }
      .tools {
        color: var(--cd-muted);
      }
      .flow {
        color: var(--cd-ink-2);
      }
      .loop-back {
        display: flex;
        align-items: center;
        gap: var(--cd-space-1);
        font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
          var(--cd-font-caption-family), sans-serif;
        color: var(--cd-caution);
      }
      .gap {
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
        color: var(--cd-caution);
      }
    `,
  ];

  protected readonly composant = StepRow;

  protected override render() {
    const { name, kindLabel, icon, tools, flow, loopBack, gap } = this.data;
    return html`<div part="row" class="row ${gap === null ? '' : 'gapped'}">
      <span class="icon" aria-hidden="true"><cd-icon .data=${{ name: gap === null ? icon : 'alert', size: 'sm' }}></cd-icon></span>
      <div class="main">
        <p class="title">${name}${kindLabel === name ? nothing : html`<span class="kind"> · ${kindLabel}</span>`}</p>
        ${tools === null ? nothing : html`<p class="tools">${tools}</p>`}
        <p class="flow">${flow}</p>
        ${loopBack === null
          ? nothing
          : html`<p class="loop-back"><cd-icon .data=${{ name: 'undo', size: 'sm' }}></cd-icon>${t('stepRow.loopBack', { loopBack })}</p>`}
        ${gap === null ? nothing : html`<p class="gap">${gap}</p>`}
      </div>
    </div>`;
  }
}
