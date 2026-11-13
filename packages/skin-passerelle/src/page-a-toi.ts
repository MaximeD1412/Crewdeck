import { PageAToi, t, type CdActionDetail } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { isFilled, PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-page-a-toi`: « À toi » (`design/screens/crewdeck/a-toi.html`). Its
 * header counts every open Décision, its chips choose a Projet, its card
 * « Décisions » lists the chosen ones, or says « Rien ne t’attend ». From
 * 1280 px its Emplacements stand in a column beside the list, below it on a
 * phone; with both empty, the list takes the width. The rows' and chips' own
 * actions stop here: the page emits `open`, `act` and `filter` instead.
 */
export class PasserellePageAToi extends PasserelleElement<typeof PageAToi> {
  static override properties = { filled: { state: true } };
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

  constructor() {
    super();
    this.filled = {};
  }

  private slotChanged(event: Event) {
    const slot = event.target as HTMLSlotElement;
    this.filled = { ...this.filled, [slot.name]: isFilled(slot) };
  }

  /** A row's `open` or a chip's `select` becomes the page's own action. */
  private relay(event: Event) {
    const { composant, action, payload } = (event as CustomEvent<CdActionDetail>).detail;
    event.stopPropagation();
    if (composant === 'DecisionRow' && action === 'open') this.emit('open', payload as { id: string });
    else if (composant === 'ProjectFilter' && action === 'select') this.emit('filter', payload as { projectId: string | null });
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
                  html`<cd-decision-row .data=${row}>
                    ${actions.map(
                      (action) =>
                        html`<cd-button
                          slot="actions"
                          .data=${{
                            label: action.label,
                            variant: action.primary ? 'primary' : 'secondary',
                            size: 'sm',
                            ...(action.disabledReason === null ? {} : { state: 'disabled', disabledReason: action.disabledReason }),
                          }}
                          @click=${() => action.disabledReason === null && this.emit('act', { id: row.id, action: action.id })}
                        ></cd-button>`,
                    )}
                  </cd-decision-row>`,
              )}
        </cd-card>
        <div class="aside" ?hidden=${!withAside}>
          <slot name="loops" @slotchange=${this.slotChanged}></slot>
          <slot name="ai-accounts" @slotchange=${this.slotChanged}></slot>
        </div>
      </div>
    `;
  }
}
