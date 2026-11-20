import { PageIdee, t, type ComposantData, type Tone } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

type State = ComposantData<typeof PageIdee>['duplicates'][number]['state'];

/** The tone of a duplicate's badge, as `cd-idea-row` gives it. */
const TONES: Readonly<Record<State, Tone>> = {
  'en-analyse': 'caution',
  'a-trier': 'neutral',
  analysee: 'accent',
  retenue: 'go',
  fusionnee: 'neutral',
  rejetee: 'halt',
};

/**
 * `cd-page-idee` (`design/screens/crewdeck/idee.html`): the PageHeader of the
 * Idée, back to « Idées », its count (« #63 · Analysée ») and its
 * Emplacement `actions`; in the main column the Card « Notée » (the text
 * between quotes, then how and when in mono) and the Card of its analysis;
 * from 1280 px, beside them, the Card « Doublons possibles », a link row per
 * duplicate with its state's badge. On a phone everything stacks. The
 * analysis's actions bubble up unchanged.
 */
export class PasserellePageIdee extends PasserelleElement<typeof PageIdee> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-4);
        min-width: 0;
      }
      .layout,
      .main,
      .aside {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-4);
        min-width: 0;
      }
      .said {
        color: var(--cd-ink);
        font: var(--cd-font-title-weight) var(--cd-font-title-size) / var(--cd-font-title-line-height)
          var(--cd-font-title-family), sans-serif;
        overflow-wrap: anywhere;
        white-space: pre-line;
      }
      .how {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-muted);
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

  protected readonly composant = PageIdee;

  protected override render() {
    const { title, count, noted, analysis, duplicates } = this.data;
    return html`<cd-page-header part="header" .data=${{ title, count, back: { label: t('idee.back'), href: '/idees' } }}>
        <slot name="actions" slot="actions"></slot>
      </cd-page-header>
      <div class="layout ${duplicates.length > 0 ? 'with-aside' : ''}">
        <div class="main">
          <cd-card class="noted" .data=${{ title: t('idee.noted.title'), label: t('idee.noted.label') }}>
            <p class="said">${t('idee.noted.quote', { text: noted.text })}</p>
            <span class="how">${noted.meta}</span>
          </cd-card>
          ${analysis === null ? nothing : html`<cd-idea-analysis class="analysis" .data=${analysis}></cd-idea-analysis>`}
        </div>
        ${duplicates.length === 0
          ? nothing
          : html`<div class="aside">
              <cd-card
                class="duplicates"
                .data=${{ title: t('idee.duplicates.title'), count: duplicates.length, label: t('idee.duplicates.label'), flush: true }}
              >
                ${duplicates.map(
                  (duplicate) =>
                    html`<cd-list-row data-id=${duplicate.id} .data=${{ title: duplicate.title, meta: duplicate.meta, icon: 'bulb', href: duplicate.href }}>
                      <cd-status-badge slot="trailing" .data=${{ tone: TONES[duplicate.state], label: t(`ideaRow.state.${duplicate.state}`) }}></cd-status-badge>
                    </cd-list-row>`,
                )}
              </cd-card>
            </div>`}
      </div>`;
  }
}
