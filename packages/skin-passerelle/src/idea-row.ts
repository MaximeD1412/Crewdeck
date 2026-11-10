import { IdeaRow, t, type ComposantData, type Tone } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { isFilled, PasserelleElement, sharedStyles } from './base.js';
import { rowStyles } from './row.js';

type State = ComposantData<typeof IdeaRow>['state'];

/** The tone of each state's badge (`design/components.js`, `IDEA`). */
const TONES: Readonly<Record<State, Tone>> = {
  'en-analyse': 'caution',
  'a-trier': 'neutral',
  analysee: 'accent',
  retenue: 'go',
  fusionnee: 'neutral',
  rejetee: 'halt',
};

/**
 * `cd-idea-row`: an Idée. Its icon box (`spark` while it is analysed, else
 * `bulb`), its title (the button that opens it, stretched over the row), its
 * meta, the summary of its analysis, its facts, then its state's badge on the
 * right. The page's buttons (`actions`) go under it, on the right from 1280 px.
 * Selected, it is raised and marked current.
 */
export class PasserelleIdeaRow extends PasserelleElement<typeof IdeaRow> {
  static override properties = { hasActions: { state: true } };
  static override styles = [
    sharedStyles,
    rowStyles,
    css`
      .row {
        grid-template-columns: var(--cd-rail) var(--cd-icon-box) minmax(0, 1fr) auto;
      }
      .icon {
        color: var(--cd-muted);
      }
      .actions {
        grid-column: 3 / -1;
        justify-content: flex-start;
        margin-top: var(--cd-space-2);
      }
      @media (min-width: 1280px) {
        .row {
          grid-template-columns: var(--cd-rail) var(--cd-icon-box) minmax(0, 1fr) auto auto;
        }
        .actions {
          grid-column: auto;
          margin-top: 0;
        }
      }
    `,
  ];

  protected readonly composant = IdeaRow;
  declare hasActions: boolean;

  constructor() {
    super();
    this.hasActions = false;
  }

  protected override render() {
    const { id, title, meta, state, summary, impact, effort, duplicates, selected } = this.data;
    const facts = [
      impact === null ? null : t('ideaRow.impact', { impact }),
      effort === null ? null : t('ideaRow.effort', { effort }),
      duplicates,
    ].filter((fact) => fact !== null);
    return html`<div part="row" class="row ${selected ? 'selected' : ''}">
      <span class="rail"></span>
      <span class="icon"><cd-icon .data=${{ name: state === 'en-analyse' ? 'spark' : 'bulb', size: 'sm' }}></cd-icon></span>
      <div class="main">
        <button
          type="button"
          class="open title"
          aria-current=${selected ? 'true' : nothing}
          @click=${() => this.emit('open', { id })}
        >
          ${title}
        </button>
        <span class="meta">${meta}</span>
        ${summary === null ? nothing : html`<span class="context">${summary}</span>`}
        ${facts.length === 0 ? nothing : html`<span class="facts">${facts.map((fact) => html`<span>${fact}</span>`)}</span>`}
      </div>
      <span class="aside badge">
        <cd-status-badge .data=${{ tone: TONES[state], label: t(`ideaRow.state.${state}`) }}></cd-status-badge>
      </span>
      <div class="aside actions over" ?hidden=${!this.hasActions}>
        <slot name="actions" @slotchange=${(e: Event) => (this.hasActions = isFilled(e.target as HTMLSlotElement))}></slot>
      </div>
    </div>`;
  }
}
