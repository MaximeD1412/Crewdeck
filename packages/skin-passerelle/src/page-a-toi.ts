import { BREAKPOINT_PX, PageAToi, t, type CdActionDetail, type ComposantData } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { isFilled, PasserelleElement, sharedStyles } from './base.js';

type Action = ComposantData<typeof PageAToi>['decisions'][number]['actions'][number];

/**
 * `cd-page-a-toi`: « À toi » (`design/screens/crewdeck/a-toi.html`). Its
 * header counts every open Décision, its chips choose a Projet, its card
 * « Décisions » lists the chosen ones, or says « Rien ne t’attend ». From
 * 1280 px its Emplacements stand in a column beside the list, below it on a
 * phone; with both empty, the list takes the width. The rows' and chips' own
 * actions stop here: the page emits `open`, `act` and `filter` instead.
 * Narrower than 1280 px, where a row hides its buttons, a Décision with
 * buttons of its own (not only « Ouvrir ») opens in place: a `cd-dialog`
 * with its kind, its meta, its context and its buttons, each one emitting
 * `act` and closing it. One whose only button is « Ouvrir » emits `open`.
 */
export class PasserellePageAToi extends PasserelleElement<typeof PageAToi> {
  static override properties = { filled: { state: true }, opened: { state: true } };
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-4);
      }
      .layout {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-4);
      }
      .aside {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-4);
        min-width: 0;
      }
      .aside[hidden] {
        display: none;
      }
      .opened p {
        margin: 0;
      }
      .opened .kind {
        color: var(--cd-muted);
        font-weight: 500;
      }
      .opened .context {
        color: var(--cd-ink);
      }
      @media (min-width: 1280px) {
        .layout.with-aside {
          display: grid;
          grid-template-columns: minmax(0, 1fr) var(--cd-aside-width);
          gap: var(--cd-space-6);
          align-items: start;
        }
      }
    `,
  ];

  protected readonly composant = PageAToi;
  /** The Emplacements that hold something, by name. */
  declare filled: Readonly<Record<string, boolean>>;
  /** The Décision opened in place, below 1280 px, by id. */
  declare opened: string | null;

  private readonly wide = matchMedia(`(min-width: ${BREAKPOINT_PX}px)`);
  /** From 1280 px the row shows its buttons again: the opened Décision closes. */
  private readonly onWide = () => {
    if (this.wide.matches) this.opened = null;
  };

  constructor() {
    super();
    this.filled = {};
    this.opened = null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.wide.addEventListener('change', this.onWide);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.wide.removeEventListener('change', this.onWide);
  }

  private slotChanged(event: Event) {
    const slot = event.target as HTMLSlotElement;
    this.filled = { ...this.filled, [slot.name]: isFilled(slot) };
  }

  /** A row's `open` or a chip's `select` becomes the page's own action. */
  private relay(event: Event) {
    const { composant, action, payload } = (event as CustomEvent<CdActionDetail>).detail;
    event.stopPropagation();
    if (composant === 'DecisionRow' && action === 'open') this.openRow((payload as { id: string }).id);
    else if (composant === 'ProjectFilter' && action === 'select') this.emit('filter', payload as { projectId: string | null });
  }

  /** A row's tap: its own buttons, opened in place, while the row hides them; else the page's `open`. */
  private openRow(id: string) {
    const decision = this.data.decisions.find((candidate) => candidate.id === id);
    const ownButtons = decision?.actions.some((action) => action.id !== 'open') ?? false;
    if (ownButtons && !this.wide.matches) this.opened = id;
    else this.emit('open', { id });
  }

  private act(id: string, action: Action) {
    if (action.disabledReason !== null) return;
    this.opened = null;
    this.emit('act', { id, action: action.id });
  }

  private button(id: string, action: Action, size: 'sm' | 'md') {
    return html`<cd-button
      slot="actions"
      .data=${{
        label: action.label,
        variant: action.primary ? 'primary' : 'secondary',
        size,
        ...(action.disabledReason === null ? {} : { state: 'disabled', disabledReason: action.disabledReason }),
      }}
      @click=${() => this.act(id, action)}
    ></cd-button>`;
  }

  /** The Décision opened in place: `close` (« Fermer », Escape, the scrim) stops here. */
  private renderOpened() {
    const decision = this.data.decisions.find((candidate) => candidate.id === this.opened);
    if (!decision) return nothing;
    const onClose = (event: Event) => {
      event.stopPropagation();
      if ((event as CustomEvent<CdActionDetail>).detail.action === 'close') this.opened = null;
    };
    return html`<cd-dialog part="opened" class="opened" .data=${{ open: true, title: decision.title }} @cd-action=${onClose}>
      <p class="kind">${decision.kind}</p>
      <p class="meta">${decision.meta}</p>
      ${decision.context === null ? nothing : html`<p class="context">${decision.context}</p>`}
      ${decision.actions.map((action) => this.button(decision.id, action, 'md'))}
    </cd-dialog>`;
  }

  protected override render() {
    const { total, projects, decisions, canNoteIdea } = this.data;
    const withAside = Object.values(this.filled).some(Boolean);
    return html`
      <cd-page-header
        part="header"
        .data=${{ title: t('aToi.title'), count: t(total === 1 || total === 0 ? 'aToi.count.one' : 'aToi.count.other', { count: total }) }}
      >
        ${canNoteIdea
          ? html`<cd-button
              slot="actions"
              class="note-idea"
              .data=${{ label: t('aToi.noteIdea'), variant: 'primary', size: 'md', icon: 'plus' }}
              @click=${() => this.emit('note-idea', {})}
            ></cd-button>`
          : nothing}
      </cd-page-header>
      <cd-project-filter
        part="projects"
        .data=${{ chips: projects.map((p) => ({ projectId: p.id, label: p.name, count: p.count, selected: p.selected })) }}
        @cd-action=${this.relay}
      ></cd-project-filter>
      <div class="layout ${withAside ? 'with-aside' : ''}">
        <cd-card
          part="decisions"
          class="decisions"
          .data=${{ title: t('aToi.decisions'), count: decisions.length, label: t('aToi.decisions.label'), flush: decisions.length > 0 }}
          @cd-action=${this.relay}
        >
          ${decisions.length === 0
            ? html`<cd-empty .data=${{ icon: 'inbox', title: t('aToi.empty.title') }}>${t('aToi.empty.body')}</cd-empty>`
            : decisions.map(
                ({ actions, ...row }) =>
                  html`<cd-decision-row .data=${row}>${actions.map((action) => this.button(row.id, action, 'sm'))}</cd-decision-row>`,
              )}
        </cd-card>
        <div class="aside" ?hidden=${!withAside}>
          <slot name="loops" @slotchange=${this.slotChanged}></slot>
          <slot name="ai-accounts" @slotchange=${this.slotChanged}></slot>
        </div>
      </div>
      ${this.renderOpened()}
    `;
  }
}
