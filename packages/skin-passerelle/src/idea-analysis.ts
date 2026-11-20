import { IdeaAnalysis, t, type CdActionDetail, type ComposantData } from '@crewdeck/sdk';
import { css, html, nothing, type TemplateResult } from 'lit';
import { isFilled, PasserelleElement, sharedStyles } from './base.js';

type Data = ComposantData<typeof IdeaAnalysis>;
type Target = NonNullable<Data['target']>;

/** The id of « nouveau » in the Menu: never a Projet's id, which is a UUID. */
const NEW_PROJECT = 'nouveau';

/** The Menu of « Changer »: the Pilote's Projets, then « nouveau ». */
const targetMenu = (target: Target) => {
  const entry = (choice: Target['choices'][number]) => ({
    id: choice.projectId ?? NEW_PROJECT,
    label: choice.label,
    icon: null,
    detail: null,
    selected: choice.selected,
    disabled: false,
  });
  const projects = target.choices.filter((choice) => choice.projectId !== null).map(entry);
  const fresh = target.choices.filter((choice) => choice.projectId === null).map(entry);
  return {
    title: t('idees.analyse.target.menu'),
    groups: [
      ...(projects.length === 0 ? [] : [{ label: t('idees.analyse.target.projects'), items: projects }]),
      ...(fresh.length === 0 ? [] : [{ label: t('idees.analyse.target.newGroup'), items: fresh }]),
    ],
  };
};

/**
 * `cd-idea-analysis`: an Idée's analysis in a Card (`idee.html`, the aside
 * of `idees.html` and `idees-analyse-echouee.html`). Its heading in bold;
 * running, « L'analyse est en cours. »; waiting, a Banner « En attente du
 * Runner »; failed, the `halt` Banner « Analyse échouée » listing the rules
 * not met, then « Relancer l'analyse » (`reanalyse`); passed, its summary and
 * its facts as a `<dl>` like `cd-key-value`, the Projet visé with
 * « Changer », which opens a `cd-menu` of the choices under it (`target` on a
 * choice, Escape or a press outside closes it). The Rôle, Moteur and when in
 * mono; last, its Emplacement `actions`, under « Tu peux aussi la trier sans
 * analyse : » when it failed.
 */
export class PasserelleIdeaAnalysis extends PasserelleElement<typeof IdeaAnalysis> {
  static override properties = { choosing: { state: true }, hasActions: { state: true } };
  static override styles = [
    sharedStyles,
    css`
      .heading {
        font: var(--cd-font-title-weight) var(--cd-font-label-size) / var(--cd-font-title-line-height)
          var(--cd-font-title-family), sans-serif;
        color: var(--cd-ink);
      }
      .text {
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
        color: var(--cd-ink-2);
      }
      .rules {
        margin: var(--cd-space-1) 0;
        padding-left: var(--cd-space-4);
      }
      dl {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: var(--cd-space-2) var(--cd-space-4);
        align-items: baseline;
        margin: 0;
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
      }
      dt {
        color: var(--cd-muted);
      }
      dd {
        margin: 0;
        color: var(--cd-ink);
        overflow-wrap: anywhere;
      }
      .cluster {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cd-space-2);
      }
      .links {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-1);
      }
      .menu-anchor {
        position: relative;
        display: inline-flex;
      }
      .menu-anchor > cd-menu {
        position: absolute;
        top: calc(100% + var(--cd-space-2));
        left: 0;
        z-index: 5;
      }
      .run {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-muted);
      }
    `,
  ];

  protected readonly composant = IdeaAnalysis;
  /** Whether the Menu of « Changer » is open: the Skin's own state, the Projet visé stays the data's. */
  declare choosing: boolean;
  declare hasActions: boolean;
  /** Whether the Menu was open when « Changer » was pressed: the Menu closes itself on that press, the click then opens nothing. */
  private wasChoosing = false;

  constructor() {
    super();
    this.choosing = false;
    this.hasActions = false;
  }

  private onMenu(event: Event) {
    const { composant, action, payload } = (event as CustomEvent<CdActionDetail>).detail;
    if (composant !== 'Menu') return;
    event.stopPropagation();
    this.choosing = false;
    if (action !== 'choose') return;
    const id = (payload as { id: string }).id;
    this.emit('target', { id: this.data.id, projectId: id === NEW_PROJECT ? null : id });
  }

  private onChange() {
    const closing = this.wasChoosing;
    this.wasChoosing = false;
    if (!closing) this.choosing = !this.choosing;
  }

  private target(target: Target): TemplateResult {
    return html`<dt>${t('idees.analyse.target')}</dt>
      <dd class="cluster">
        <span class="target">${target.label}</span>
        <span class="menu-anchor">
          <cd-button
            class="change"
            aria-haspopup="menu"
            aria-expanded=${this.choosing ? 'true' : 'false'}
            .data=${{ label: t('idees.analyse.target.change'), variant: 'ghost', size: 'sm', icon: 'pen' }}
            @pointerdown=${() => (this.wasChoosing = this.choosing)}
            @keydown=${() => (this.wasChoosing = false)}
            @click=${this.onChange}
          ></cd-button>
          ${this.choosing ? html`<cd-menu .data=${targetMenu(target)} @cd-action=${this.onMenu}></cd-menu>` : nothing}
        </span>
      </dd>`;
  }

  private facts(): TemplateResult | typeof nothing {
    const { target, impact, effort, duplicates } = this.data;
    if (target === null && impact === null && effort === null && duplicates.length === 0) return nothing;
    return html`<dl part="facts">
      ${target === null ? nothing : this.target(target)}
      ${impact === null ? nothing : html`<dt>${t('idees.analyse.impact')}</dt><dd class="impact">${impact}</dd>`}
      ${effort === null ? nothing : html`<dt>${t('idees.analyse.effort')}</dt><dd class="effort">${effort}</dd>`}
      ${duplicates.length === 0
        ? nothing
        : html`<dt>${t(duplicates.length === 1 ? 'idees.analyse.duplicate' : 'idees.analyse.duplicates')}</dt>
            <dd class="links">${duplicates.map((duplicate) => html`<a class="duplicate" href=${duplicate.href}>${duplicate.label}</a>`)}</dd>`}
    </dl>`;
  }

  private failure(failure: NonNullable<Data['failure']>): TemplateResult {
    return html`<cd-banner class="failure" .data=${{ tone: 'halt', icon: 'alert', title: t('idees.analyse.failed') }}>
        ${failure.kind === 'incomplete'
          ? html`${t('idees.analyse.failed.incomplete')}
              <ul class="rules">
                ${failure.rules.map((rule) => html`<li>${rule}</li>`)}
              </ul>
              ${t('idees.analyse.failed.incomplete.decision')}`
          : html`${t('idees.analyse.failed.failed')} ${t('idees.analyse.failed.failed.decision')}`}
      </cd-banner>`;
  }

  protected override render() {
    const { id, title, label, heading, status, summary, failure, run } = this.data;
    const failed = status === 'failed';
    return html`<cd-card part="card" .data=${{ title, label }}>
      ${heading === null ? nothing : html`<p class="heading">${heading}</p>`}
      ${status === 'running' ? html`<p class="text running">${t('idees.analyse.running')}</p>` : nothing}
      ${status === 'waiting'
        ? html`<cd-banner class="waiting" .data=${{ tone: 'caution', icon: 'server', title: t('idees.analyse.waiting') }}>${t('idees.analyse.waiting.body')}</cd-banner>`
        : nothing}
      ${failed && failure !== null ? this.failure(failure) : nothing}
      ${summary === null ? nothing : html`<p class="text summary">${summary}</p>`}
      ${this.facts()}
      ${run === null ? nothing : html`<span class="run">${run}</span>`}
      ${failed
        ? html`<div class="cluster">
            <cd-button
              class="reanalyse"
              .data=${{ label: t('idees.analyse.reanalyse'), variant: 'primary', size: 'sm', icon: 'refresh' }}
              @click=${() => this.emit('reanalyse', { id })}
            ></cd-button>
          </div>`
        : nothing}
      ${failed && this.hasActions ? html`<p class="text without">${t('idees.analyse.withoutAnalysis')}</p>` : nothing}
      <div class="cluster actions" ?hidden=${!this.hasActions}>
        <slot name="actions" @slotchange=${(e: Event) => (this.hasActions = isFilled(e.target as HTMLSlotElement))}></slot>
      </div>
    </cd-card>`;
  }
}
