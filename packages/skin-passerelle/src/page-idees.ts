import { PageIdees, t, type CdActionDetail, type IdeesTab } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { isFilled, PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-page-idees`: « Idées » (`design/screens/crewdeck/idees.html`). Its
 * header counts the Idées to triage and holds « Noter une Idée »; under it
 * the Projet chips and the tabs, then the tab's Idées in a Card titled by the
 * tab. With no Idée at all, only the header and a Card « Aucune Idée pour
 * l’instant » whose « Noter une Idée » emits `note` too
 * (`idees-vide.html`). Under the list, while older Idées remain (`older`),
 * « Afficher les plus anciennes » emits `more`. A row whose analysis failed
 * holds the `halt` badge « Analyse échouée » and « Relancer l'analyse »
 * (`reanalyse`) in its Emplacement `actions`
 * (`idees-analyse-echouee.html`). From 1280 px the Emplacement `aside`
 * stands beside the list, hidden narrower (a phone opens the Idée's own
 * page instead); `list` replaces the list. The rows', chips' and tabs'
 * own actions stop here: the page emits `open`, `filter` and `tab` instead.
 */
export class PasserellePageIdees extends PasserelleElement<typeof PageIdees> {
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
        display: none;
        flex-direction: column;
        gap: var(--cd-space-4);
        min-width: 0;
      }
      .older {
        display: flex;
        justify-content: center;
      }
      @media (min-width: 1280px) {
        .aside:not([hidden]) {
          display: flex;
        }
        .layout.with-aside {
          display: grid;
          grid-template-columns: minmax(0, 1fr) var(--cd-aside-width);
          gap: var(--cd-space-6);
          align-items: start;
        }
      }
    `,
  ];

  protected readonly composant = PageIdees;
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

  /** A row's `open`, a chip's or a tab's `select` becomes the page's own action. */
  private relay(event: Event) {
    const { composant, action, payload } = (event as CustomEvent<CdActionDetail>).detail;
    event.stopPropagation();
    if (composant === 'IdeaRow' && action === 'open') this.emit('open', payload as { id: string });
    else if (composant === 'ProjectFilter' && action === 'select') this.emit('filter', payload as { projectId: string | null });
    else if (composant === 'Tabs' && action === 'select') this.emit('tab', { tab: (payload as { id: IdeesTab }).id });
  }

  private noteButton(slot: string, className: string) {
    return html`<cd-button
      slot=${slot}
      class=${className}
      .data=${{ label: t('idees.note'), variant: 'primary', size: 'md', icon: 'plus' }}
      @click=${() => this.emit('note', {})}
    ></cd-button>`;
  }

  private empty() {
    return html`<cd-card part="list" class="list" .data=${{ label: t('idees.list.label') }}>
      <cd-empty .data=${{ icon: 'bulb', title: t('idees.empty.title') }}>${t('idees.empty.body')} ${this.noteButton('actions', 'note-empty')}</cd-empty>
    </cd-card>`;
  }

  private older() {
    const { older } = this.data;
    if (older === 'none') return nothing;
    return html`<div class="older">
      <cd-button
        class="more"
        .data=${{ label: t('idees.older'), variant: 'secondary', size: 'md', ...(older === 'loading' ? { state: 'loading' as const } : {}) }}
        @click=${() => this.emit('more', {})}
      ></cd-button>
    </div>`;
  }

  /** The signals of a row whose analysis failed, in its Emplacement `actions`. */
  private failed(id: string) {
    return html`<cd-status-badge slot="actions" .data=${{ tone: 'halt', label: t('idees.analyse.failed') }}></cd-status-badge>
      <cd-button
        slot="actions"
        class="reanalyse"
        .data=${{ label: t('idees.analyse.reanalyse'), variant: 'secondary', size: 'sm', icon: 'refresh' }}
        @click=${(event: Event) => {
          event.stopPropagation();
          this.emit('reanalyse', { id });
        }}
      ></cd-button>`;
  }

  private list() {
    const { tabs, ideas } = this.data;
    const tab = tabs.find((candidate) => candidate.selected);
    return html`<cd-card
      part="list"
      class="list"
      .data=${{ title: tab?.label ?? t('idees.title'), count: ideas.length, label: t('idees.list.label'), flush: ideas.length > 0 }}
      @cd-action=${this.relay}
    >
      ${ideas.length === 0
        ? html`<cd-empty .data=${{ icon: 'bulb', title: t('idees.tabEmpty.title') }}>${t('idees.tabEmpty.body')}</cd-empty>`
        : ideas.map((idea) => html`<cd-idea-row data-id=${idea.id} .data=${idea}>${idea.failed ? this.failed(idea.id) : nothing}</cd-idea-row>`)}
    </cd-card>`;
  }

  protected override render() {
    const { toTriage, empty, projects, tabs } = this.data;
    const withAside = !empty && Boolean(this.filled['aside']);
    return html`
      <cd-page-header part="header" .data=${{ title: t('idees.title'), count: empty ? '0' : t('idees.count', { count: toTriage }) }}>
        ${empty ? nothing : this.noteButton('actions', 'note')}
      </cd-page-header>
      ${empty
        ? this.empty()
        : html`<cd-project-filter part="projects" .data=${{ chips: projects }} @cd-action=${this.relay}></cd-project-filter>
            <cd-tabs part="tabs" .data=${{ tabs }} @cd-action=${this.relay}></cd-tabs>
            <div class="layout ${withAside ? 'with-aside' : ''}">
              <slot name="list" @slotchange=${this.slotChanged}>${this.list()}${this.older()}</slot>
              <div class="aside" ?hidden=${!withAside}>
                <slot name="aside" @slotchange=${this.slotChanged}></slot>
              </div>
            </div>`}
    `;
  }
}
