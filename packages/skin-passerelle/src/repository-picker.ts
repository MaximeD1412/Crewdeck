import { FOLLOW_PROJECTS_MAX, RepositoryPicker, t, type ComposantData } from '@crewdeck/sdk';
import { css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

type Data = ComposantData<typeof RepositoryPicker>;
type Repository = Data['repositories'][number];

/** The repositories whose full name holds `query`, case aside. */
const matching = (repositories: readonly Repository[], query: string): readonly Repository[] => {
  const needle = query.trim().toLowerCase();
  return needle === '' ? repositories : repositories.filter((repository) => repository.fullName.toLowerCase().includes(needle));
};

const followLabel = (count: number): string =>
  count === 0 ? t('projets.picker.follow.none') : count === 1 ? t('projets.picker.follow.one') : t('projets.picker.follow.many', { count });

/**
 * `cd-repository-picker` (`design/screens/crewdeck/demarrage-projets.html`):
 * on `/projets/ajouter` its PageHeader and its explanation first. The search
 * field (its label read, not shown) filters the list in the page; the flush
 * Card « Tes dépôts GitHub » holds a Checkbox per repository, its meta saying
 * whether it already has code; « Suivre <n> Projets » (`follow`) is disabled
 * with its reason at none or past `FOLLOW_PROJECTS_MAX`, « Plus tard »
 * (`later`) beside it in « Premiers pas »; the Inventaire's footnote and the
 * link to GitHub's installation page under them. Without any repository, an
 * Empty whose action is that link. What is checked stays checked while the
 * search hides it, and leaves once the repository leaves `repositories`.
 */
export class PasserelleRepositoryPicker extends PasserelleElement<typeof RepositoryPicker> {
  static override properties = { query: { state: true }, selected: { state: true } };
  static override styles = [
    sharedStyles,
    css`
      :host,
      section {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-5);
      }
      .head {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
      }
      p {
        color: var(--cd-ink-2);
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
      }
      .muted {
        color: var(--cd-muted);
      }
      cd-text-field::part(label) {
        position: absolute;
        width: var(--cd-stroke);
        height: var(--cd-stroke);
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      .repos {
        display: flex;
        flex-direction: column;
        padding: 0 var(--cd-space-4) var(--cd-space-2);
      }
      .repos cd-checkbox + cd-checkbox {
        border-top: thin solid var(--cd-line);
      }
      .repos cd-checkbox::part(choice) {
        padding: var(--cd-space-2) 0;
      }
      .no-match {
        padding: var(--cd-space-3) 0;
      }
      .actions {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
        --passerelle-button-width: 100%;
      }
      .install {
        display: inline-flex;
        align-items: center;
        min-height: var(--cd-touch);
        font: var(--cd-font-label-weight) var(--cd-font-label-size) / var(--cd-font-label-line-height)
          var(--cd-font-label-family), sans-serif;
      }
      .install.primary {
        align-self: center;
        justify-content: center;
        padding: 0 var(--cd-space-4);
        border-radius: var(--cd-radius);
        background: var(--cd-accent);
        color: var(--cd-accent-ink);
      }
      .install.primary:hover {
        background: var(--cd-accent-hover);
        color: var(--cd-accent-ink);
      }
      @media (min-width: 1280px) {
        .repos {
          padding: 0 var(--cd-space-5) var(--cd-space-2);
        }
        .actions {
          flex-direction: row-reverse;
          justify-content: flex-start;
          --passerelle-button-width: auto;
        }
      }
    `,
  ];

  protected readonly composant = RepositoryPicker;
  declare query: string;
  declare selected: ReadonlySet<string>;

  constructor() {
    super();
    this.query = '';
    this.selected = new Set();
  }

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (!changed.has('data')) return;
    const present = new Set(this.data.repositories.map((repository) => repository.id));
    if ([...this.selected].some((id) => !present.has(id))) this.selected = new Set([...this.selected].filter((id) => present.has(id)));
  }

  private onSearch(event: Event) {
    this.query = (event.currentTarget as HTMLElement & { value: string }).value;
  }

  private onCheck(id: string, event: Event) {
    const { checked } = event.currentTarget as HTMLElement & { checked: boolean };
    const next = new Set(this.selected);
    if (checked) next.add(id);
    else next.delete(id);
    this.selected = next;
  }

  private follow() {
    const count = this.selected.size;
    if (this.data.busy || count === 0 || count > FOLLOW_PROJECTS_MAX) return;
    this.emit('follow', { repositoryIds: [...this.selected] });
  }

  private installLink(primary: boolean): TemplateResult | typeof nothing {
    const { installUrl } = this.data;
    if (installUrl === null) return nothing;
    return html`<a class="install ${primary ? 'primary' : ''}" part="install" href=${installUrl}
      >${t(primary ? 'projets.picker.none.action' : 'projets.picker.install')}</a
    >`;
  }

  private later(): TemplateResult | typeof nothing {
    if (this.data.context !== 'demarrage') return nothing;
    const busy = this.data.busy ? { state: 'disabled' as const } : {};
    return html`<cd-button
      class="later"
      .data=${{ label: t('projets.picker.later'), variant: 'ghost', size: 'md', ...busy }}
      @click=${() => {
        if (!this.data.busy) this.emit('later', {});
      }}
    ></cd-button>`;
  }

  private list(): TemplateResult {
    const { repositories, busy } = this.data;
    const shown = matching(repositories, this.query);
    const count = this.selected.size;
    const state = busy
      ? { state: 'loading' as const }
      : count === 0
        ? { state: 'disabled' as const, disabledReason: t('projets.picker.follow.noneReason') }
        : count > FOLLOW_PROJECTS_MAX
          ? { state: 'disabled' as const, disabledReason: t('projets.picker.follow.tooManyReason', { max: FOLLOW_PROJECTS_MAX }) }
          : {};
    return html`<cd-text-field
        class="search"
        .data=${{
          name: 'search',
          label: t('projets.picker.search'),
          value: '',
          placeholder: t('projets.picker.search'),
          help: null,
          error: null,
          state: null,
          multiline: false,
          maxLength: null,
        }}
        @input=${this.onSearch}
      ></cd-text-field>
      <cd-card .data=${{ title: t('projets.picker.list.title'), count: repositories.length, flush: true }}>
        <div class="repos">
          ${shown.map(
            (repository) =>
              html`<cd-checkbox
                data-repository=${repository.id}
                .data=${{
                  name: `repository-${repository.id}`,
                  label: repository.fullName,
                  meta: t(repository.hasCode ? 'projets.picker.hasCode' : 'projets.picker.empty'),
                  checked: this.selected.has(repository.id),
                }}
                @input=${(event: Event) => this.onCheck(repository.id, event)}
              ></cd-checkbox>`,
          )}
          ${shown.length === 0 ? html`<p class="no-match muted">${t('projets.picker.noMatch', { query: this.query.trim() })}</p>` : nothing}
        </div>
      </cd-card>
      <div class="actions">
        <cd-button class="follow" .data=${{ label: followLabel(count), variant: 'primary', size: 'md', ...state }} @click=${this.follow}></cd-button>
        ${this.later()}
      </div>
      <p class="muted">${t('projets.picker.footnote')}</p>
      ${this.installLink(false)}`;
  }

  private none(): TemplateResult {
    return html`<cd-card .data=${{}}>
        <cd-empty .data=${{ icon: 'folder', title: t('projets.picker.none.title') }}
          >${t('projets.picker.none.text')}<span slot="actions">${this.installLink(true)}</span></cd-empty
        >
      </cd-card>
      ${this.data.context === 'demarrage' ? html`<div class="actions">${this.later()}</div>` : nothing}`;
  }

  protected override render() {
    const { context, repositories } = this.data;
    const head =
      context === 'projets'
        ? html`<div class="head">
            <cd-page-header .data=${{ title: t('projets.ajouter.title'), back: { label: t('projets.ajouter.back'), href: '/projets' } }}></cd-page-header>
            <p part="lead">${t('projets.picker.lead')}</p>
          </div>`
        : nothing;
    return html`${head}
      <section aria-label=${t('projets.picker.label')}>${repositories.length === 0 ? this.none() : this.list()}</section>`;
  }
}
