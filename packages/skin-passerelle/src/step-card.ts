import { StepCard, t } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { isFilled, PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-step-card`: an Étape, a focusable `article` named « Étape / <name> »:
 * its head (the name, its kind, its Manques), its ports (Entrées then
 * Sorties, the `ports` Emplacement), and its footer: its Outils (`tools`, or
 * « aucun Outil ») and the Retour's handle when it judges. A gate has no
 * Outils footer, only the handle. Its host is the card: the canvas measures it.
 */
export class PasserelleStepCard extends PasserelleElement<typeof StepCard> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        justify-self: start;
        width: var(--cd-step-card);
        position: relative;
        z-index: 1;
      }
      :host([data-variant='gate']) {
        width: var(--cd-gate-card);
        --port-label-wrap: normal;
      }
      article {
        display: flex;
        flex-direction: column;
        background: var(--cd-panel);
        border: thin solid var(--cd-line-strong);
        border-radius: var(--cd-radius-lg);
        cursor: pointer;
      }
      article:focus-visible {
        outline: var(--cd-stroke) solid var(--cd-accent);
        outline-offset: var(--cd-stroke);
      }
      .gate {
        background: var(--cd-sunk);
        border-style: dashed;
      }
      .core {
        border-left: var(--cd-rail) solid var(--cd-line-strong);
      }
      .selected {
        border-color: var(--cd-accent);
        box-shadow: 0 0 0 var(--cd-stroke) var(--cd-accent-soft);
      }
      .gaps {
        border-color: var(--cd-caution);
        border-style: solid;
      }
      header {
        display: flex;
        flex-direction: column;
        padding: var(--cd-space-2) var(--cd-space-3);
        border-bottom: thin solid var(--cd-line);
      }
      .name {
        font: var(--cd-font-label-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-label-family), sans-serif;
        color: var(--cd-ink);
      }
      .kind {
        display: flex;
        align-items: center;
        gap: var(--cd-space-1);
        font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
          var(--cd-font-caption-family), sans-serif;
        color: var(--cd-muted);
      }
      .command .kind {
        color: var(--cd-accent-text);
      }
      .core .kind {
        color: var(--cd-ink-2);
      }
      .gap-count {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: var(--cd-space-1);
        color: var(--cd-caution);
      }
      .ports {
        display: flex;
        flex-direction: column;
        padding: var(--cd-space-1) 0;
      }
      footer {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cd-space-1);
        padding: var(--cd-space-2) var(--cd-space-3);
        border-top: thin solid var(--cd-line);
      }
      .gate footer {
        justify-content: flex-end;
        padding: var(--cd-space-1) var(--cd-space-2);
      }
      .none {
        font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
          var(--cd-font-caption-family), sans-serif;
        color: var(--cd-muted);
      }
      .handle {
        margin-left: auto;
        width: var(--cd-icon-box);
        height: var(--cd-icon-box);
        display: grid;
        place-items: center;
        border-radius: var(--cd-radius-full);
        border: thin solid var(--cd-caution);
        background: var(--cd-caution-soft);
        color: var(--cd-caution);
        cursor: grab;
        touch-action: none;
      }
    `,
  ];

  protected readonly composant = StepCard;

  /** Whether the `tools` Emplacement holds an Outil: « aucun Outil » otherwise. */
  private hasTools = true;

  protected override willUpdate(): void {
    this.dataset['variant'] = this.data.variant;
    this.hasTools = [...this.children].some((child) => child.slot === 'tools');
  }

  private readonly onToolsChange = (event: Event) => {
    const filled = isFilled(event.target as HTMLSlotElement);
    if (filled !== this.hasTools) {
      this.hasTools = filled;
      this.requestUpdate();
    }
  };

  private readonly onKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
    event.preventDefault();
    this.emit('select', {});
  };

  private readonly onHandleDown = (event: PointerEvent) => {
    event.stopPropagation();
    this.emit('startLoopBack', {});
  };

  protected override render() {
    const { name, kindLabel, variant, selected, gaps, judges } = this.data;
    const gate = variant === 'gate';
    const classes = [variant, selected ? 'selected' : '', gaps > 0 ? 'gaps' : ''].join(' ');
    const handle = judges
      ? html`<span class="handle" part="handle" title=${t('stepCard.loopBackHandle')} @pointerdown=${this.onHandleDown}>
          <cd-icon .data=${{ name: 'undo', size: 'sm' }}></cd-icon>
        </span>`
      : nothing;
    return html`<article
      part="card"
      class=${classes}
      tabindex="0"
      aria-label=${t('stepCard.label', { name })}
      @click=${() => this.emit('select', {})}
      @keydown=${this.onKeydown}
    >
      <header>
        <b class="name">${name}</b>
        <span class="kind">
          ${gate ? html`<cd-icon .data=${{ name: 'user', size: 'sm' }}></cd-icon>` : nothing}${kindLabel}
          ${gaps > 0
            ? html`<span class="gap-count"
                ><cd-icon .data=${{ name: 'alert', size: 'sm' }}></cd-icon>${t(gaps === 1 ? 'canvas.gaps.one' : 'canvas.gaps.other', {
                  count: gaps,
                })}</span
              >`
            : nothing}
        </span>
      </header>
      <div class="ports"><slot name="ports"></slot></div>
      ${gate
        ? judges
          ? html`<footer>${handle}</footer>`
          : nothing
        : html`<footer>
            <slot name="tools" @slotchange=${this.onToolsChange}></slot>
            ${this.hasTools ? nothing : html`<span class="none">${t('stepCard.noTools')}</span>`}${handle}
          </footer>`}
    </article>`;
  }
}
