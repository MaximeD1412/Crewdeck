import { BREAKPOINT_PX, PageProcessEditor, t, type CdActionDetail, type ComposantData } from '@crewdeck/sdk';
import { css, html, nothing, type TemplateResult } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

type Data = ComposantData<typeof PageProcessEditor>;
type Tab = Data['tab'];
type Step = NonNullable<Data['step']>;
type Phase = NonNullable<Data['phase']>;
type Row = Step['tools'][number];
type SourceRow = Data['sources']['rows'][number];
type SourceSelect = NonNullable<SourceRow['select']>;

const TABS: readonly Tab[] = ['gaps', 'selection', 'sources'];
const isTab = (id: unknown): id is Tab => TABS.includes(id as Tab);

/**
 * `cd-page-process-editor` (`design/screens/gestion-du-process/process.html`):
 * the PageHeader, a caution Banner while there is no active version, then,
 * from 1280 px, the editor taking the height the compact Cadre leaves: the
 * ProcessCanvas, and its panel (`--cd-aside-width`), Tabs « Manques »,
 * « Étape » or « Phase », « Sources », the versions at its foot. Below 1280
 * px the editor is not rendered: the Sources' card only, under the Banner of
 * a migration of Source running (`process-migration-en-cours.html`). The
 * canvas's `select` and `view` become the page's (`centre: false`), a
 * Manque's row a `select` that centres its block; a group's Select changed,
 * `migrate`, the Select back on its Source until the page says otherwise.
 */
export class PasserellePageProcessEditor extends PasserelleElement<typeof PageProcessEditor> {
  static override properties = { wide: { state: true } };
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-4);
        flex: 1;
        min-width: 0;
        min-height: 0;
      }
      .editor {
        display: grid;
        grid-template-columns: minmax(0, 1fr) var(--cd-aside-width);
        grid-template-rows: minmax(0, 1fr);
        flex: 1;
        min-height: 0;
        margin: 0 calc(var(--cd-space-6) * -1);
        border-top: thin solid var(--cd-line);
      }
      cd-process-canvas {
        min-height: 0;
        height: 100%;
      }
      aside {
        display: flex;
        flex-direction: column;
        min-height: 0;
        background: var(--cd-panel);
        border-left: thin solid var(--cd-line);
      }
      cd-tabs {
        padding: 0 var(--cd-space-3);
      }
      .panel-body {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: var(--cd-space-4);
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-5);
      }
      .foot {
        border-top: thin solid var(--cd-line);
        padding: var(--cd-space-3) var(--cd-space-4);
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-1);
      }
      .lead,
      .text,
      .foot .changes {
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
        color: var(--cd-ink-2);
      }
      .mono,
      .kind {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-muted);
      }
      .section {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
      }
      .cluster {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cd-space-2);
      }
      h2,
      summary {
        display: flex;
        align-items: center;
        gap: var(--cd-space-2);
        font: var(--cd-font-section-label-weight) var(--cd-font-section-label-size) /
          var(--cd-font-section-label-line-height) var(--cd-font-section-label-family), sans-serif;
        letter-spacing: var(--cd-font-section-label-letter-spacing);
        text-transform: uppercase;
        color: var(--cd-muted);
      }
      summary {
        list-style: none;
        cursor: pointer;
        min-height: var(--cd-control-sm);
      }
      summary::-webkit-details-marker {
        display: none;
      }
      summary:focus-visible {
        outline: var(--cd-stroke) solid var(--cd-accent);
        outline-offset: var(--cd-stroke);
      }
      summary .count {
        letter-spacing: 0;
        text-transform: none;
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
      }
      summary cd-icon {
        margin-left: auto;
      }
      details[open] > summary cd-icon {
        transform: rotate(180deg);
      }
      details[open] > summary {
        margin-bottom: var(--cd-space-2);
      }
      .list {
        display: flex;
        flex-direction: column;
        border: thin solid var(--cd-line);
        border-radius: var(--cd-radius-lg);
        background: var(--cd-ground);
      }
      .list > * + * {
        border-top: thin solid var(--cd-line);
      }
      .item {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: var(--cd-space-1) var(--cd-space-2);
        align-items: center;
        width: 100%;
        padding: var(--cd-space-2) var(--cd-space-3);
        min-height: var(--cd-control);
        text-align: left;
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
        color: var(--cd-ink-2);
      }
      .item b {
        color: var(--cd-ink);
        font-weight: var(--cd-font-title-weight);
      }
      .item small {
        grid-column: 2 / -1;
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-muted);
      }
      .item > cd-icon {
        color: var(--cd-muted);
      }
      .caution > cd-icon,
      .caution small,
      .caution .mono {
        color: var(--cd-caution);
      }
      button.item:hover {
        background: var(--cd-raised);
      }
      button.item:focus-visible {
        outline-offset: calc(var(--cd-stroke) * -1);
      }
      .not-found {
        flex: 1;
      }
      /* Its label named by the row, hidden as cd-setting-row hides its own, kept as the Select's name. */
      .item cd-select {
        width: 7.5rem;
        --cd-field-label-position: absolute;
        --cd-field-label-size: var(--cd-stroke);
        --cd-field-label-overflow: hidden;
        --cd-field-label-clip: inset(50%);
        --cd-field-label-white-space: nowrap;
      }
      .phone-sources {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
      }
    `,
  ];

  protected readonly composant = PageProcessEditor;
  declare wide: boolean;
  private readonly media = matchMedia(`(min-width: ${BREAKPOINT_PX}px)`);
  private readonly onMedia = () => (this.wide = this.media.matches);

  constructor() {
    super();
    this.wide = this.media.matches;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.media.addEventListener('change', this.onMedia);
    this.onMedia();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.media.removeEventListener('change', this.onMedia);
  }

  /** The canvas's `select` and `view` become the page's. */
  private onCanvas(event: Event) {
    const { composant, action, payload } = (event as CustomEvent<CdActionDetail>).detail;
    if (composant !== 'ProcessCanvas') return;
    event.stopPropagation();
    if (action === 'select') this.emit('select', { target: (payload as { target: Data['gaps'][number]['target'] | null }).target, centre: false });
    if (action === 'view') this.emit('view', payload as { zoom: number; pan: { x: number; y: number } });
  }

  private onTabs(event: Event) {
    const { composant, action, payload } = (event as CustomEvent<CdActionDetail>).detail;
    if (composant !== 'Tabs' || action !== 'select') return;
    event.stopPropagation();
    const tab = (payload as { id?: unknown } | undefined)?.id;
    if (isTab(tab)) this.emit('tab', { tab });
  }

  private row({ icon, label, detail }: Row): TemplateResult {
    return html`<div class="item" role="listitem">
      <cd-icon .data=${{ name: icon, size: 'sm' }}></cd-icon><b>${label}</b><span></span>
      ${detail === null ? nothing : html`<small>${detail}</small>`}
    </div>`;
  }

  /** A row of the Sources: its value, its group's Select (wide only), or the badge of its migration. */
  private sourceRow(row: SourceRow): TemplateResult {
    const { icon, label, detail, value, select, migration } = row;
    const trailing =
      migration !== null
        ? html`<cd-status-badge .data=${{ tone: 'caution', label: migration }}></cd-status-badge>`
        : select && this.wide
          ? html`<cd-select
              data-group=${select.group}
              .data=${{
                name: `source.${select.group}`,
                label: select.label,
                value: select.value,
                options: select.options.map((option) => ({ ...option, disabled: false })),
                help: null,
                state: select.disabled ? 'disabled' : null,
              }}
              @change=${(event: Event) => this.choose(select, event)}
            ></cd-select>`
          : html`<span class="mono">${value}</span>`;
    return html`<div class="item ${migration === null ? '' : 'caution'}" role="listitem">
      <cd-icon .data=${{ name: icon, size: 'sm' }}></cd-icon><b>${label}</b>${trailing}
      ${detail === null ? nothing : html`<small>${detail}</small>`}
    </div>`;
  }

  /** A group's Select changed: `migrate`, the Select back on what the page says (the choice while it asks, then the Source). */
  private choose(select: SourceSelect, event: Event) {
    const control = event.currentTarget as HTMLElement & { value: string; reset(): void };
    const to = select.options.find((option) => option.value === control.value)?.value;
    if (to === undefined || to === select.value) return;
    this.emit('migrate', { group: select.group, to });
    control.reset();
  }

  private migrationBanner(): TemplateResult | typeof nothing {
    const { banner } = this.data.sources;
    if (!banner) return nothing;
    return html`<cd-banner class="migration" .data=${{ tone: 'caution', icon: 'refresh', title: banner.title }}>${banner.text}</cd-banner>`;
  }

  private gaps(): TemplateResult {
    const { gaps } = this.data;
    if (gaps.length === 0) {
      return html`<cd-empty .data=${{ icon: 'check', title: t('process.gaps.none.title') }}>${t('process.gaps.none')}</cd-empty>`;
    }
    return html`<p class="lead">${t('process.gaps.lead')}</p>
      <div class="list" role="list">
        ${gaps.map(
          (gap) =>
            html`<div role="listitem">
              <button type="button" class="item gap caution" @click=${() => this.emit('select', { target: gap.target, centre: true })}>
                <cd-icon .data=${{ name: 'alert', size: 'sm' }}></cd-icon><b>${gap.label}</b><cd-icon .data=${{ name: 'chevron-right', size: 'sm' }}></cd-icon>
                <small>${gap.meta}</small>
              </button>
            </div>`,
        )}
      </div>`;
  }

  private step(step: Step): TemplateResult {
    const ports = t('process.step.ports');
    return html`<div class="section">
        <div class="cluster">
          <cd-status-badge .data=${{ tone: 'accent', label: step.name }}></cd-status-badge>
          <span class="kind">${step.kindLabel} · ${step.phaseName}</span>
        </div>
      </div>
      ${step.loopBack === null
        ? nothing
        : html`<section class="section loop-back" aria-label=${t('process.step.loopBack.title')}>
            <h2>${t('process.step.loopBack.title')}</h2>
            <p class="text">${step.loopBack}</p>
          </section>`}
      <details class="section ports" aria-label=${ports}>
        <summary>
          ${ports} <span class="count">${t('process.step.ports.count', { inputs: step.inputs.length, outputs: step.outputs.length })}</span>
          <cd-icon .data=${{ name: 'chevron-down', size: 'sm' }}></cd-icon>
        </summary>
        <div class="list" role="list">
          ${step.inputs.map(
            (input) =>
              html`<div class="item ${input.fed ? '' : 'caution'}" role="listitem">
                <cd-icon .data=${{ name: input.fed ? 'chevron-right' : 'alert', size: 'sm' }}></cd-icon><b>${input.label}</b
                ><span class="mono">${input.from}</span>
              </div>`,
          )}
          ${step.outputs.map(
            (output) =>
              html`<div class="item" role="listitem">
                <cd-icon .data=${{ name: 'chevron-right', size: 'sm' }}></cd-icon><b>${output.label}</b><span class="mono">${output.to}</span>
              </div>`,
          )}
        </div>
      </details>
      <section class="section tools" aria-label=${t('process.step.tools')}>
        <h2>${t('process.step.tools')}</h2>
        ${step.tools.length === 0
          ? html`<p class="text">${t('process.step.tools.none')}</p>`
          : html`<div class="list" role="list">${step.tools.map((tool) => this.row(tool))}</div>`}
      </section>`;
  }

  private phase(phase: Phase): TemplateResult {
    return html`<div class="section">
        <div class="cluster">
          <cd-status-badge .data=${{ tone: 'accent', label: phase.name }}></cd-status-badge>
          <span class="kind">${phase.count}</span>
        </div>
      </div>
      <section class="section repeat">
        <p class="text">${t('process.phase.repeat', { repeat: phase.repeat })}</p>
      </section>`;
  }

  private selection(): TemplateResult {
    const { step, phase } = this.data;
    if (step) return this.step(step);
    if (phase) return this.phase(phase);
    return html`<cd-empty .data=${{ icon: 'phase', title: t('process.selection.none') }}></cd-empty>`;
  }

  private sources(): TemplateResult {
    const { lead, rows } = this.data.sources;
    return html`${this.migrationBanner()}
      <p class="lead">${lead}</p>
      <div class="list" role="list">${rows.map((row) => this.sourceRow(row))}</div>`;
  }

  /** The phone's Sources: read, a migration's Banner above them (editing stays on the PC). */
  private phoneSources(): TemplateResult {
    const { rows } = this.data.sources;
    return html`${this.migrationBanner()}
      <section class="phone-sources" aria-labelledby="phone-sources">
        <h2 id="phone-sources">${t('process.tabs.sources')}</h2>
        <div class="list" role="list">${rows.map((row) => this.sourceRow(row))}</div>
      </section>`;
  }

  private panel(): TemplateResult {
    const { tab, gaps, phase, footer } = this.data;
    const body = tab === 'gaps' ? this.gaps() : tab === 'selection' ? this.selection() : this.sources();
    return html`<aside aria-label=${t('process.panel.label')}>
      <cd-tabs
        .data=${{
          tabs: [
            { id: 'gaps', label: t('process.tabs.gaps'), count: gaps.length, selected: tab === 'gaps' },
            { id: 'selection', label: t(phase ? 'process.tabs.phase' : 'process.tabs.step'), selected: tab === 'selection' },
            { id: 'sources', label: t('process.tabs.sources'), selected: tab === 'sources' },
          ],
        }}
        @cd-action=${this.onTabs}
      ></cd-tabs>
      <div class="panel-body" role="tabpanel">${body}</div>
      <footer class="foot" aria-label=${t('process.footer.label')}>
        <p class="changes">${footer.changes}</p>
        <p class="mono">${footer.versions}</p>
      </footer>
    </aside>`;
  }

  protected override render() {
    const { found, title, hasVersion, canvas } = this.data;
    if (!found) {
      return html`<cd-empty class="not-found" .data=${{ icon: 'folder', title: t('process.notFound') }}
        ><a slot="actions" href="/projets">${t('process.notFound.back')}</a></cd-empty
      >`;
    }
    return html`<cd-page-header
        .data=${{ title: t('process.title'), count: title.count, back: { label: t('process.back', { projectName: title.projectName }), href: title.backHref } }}
      ></cd-page-header>
      ${hasVersion ? nothing : html`<cd-banner .data=${{ tone: 'caution', icon: 'alert', title: t('process.noVersion') }}></cd-banner>`}
      ${this.wide
        ? html`<div class="editor" aria-label=${t('process.editor.label')} role="region">
            <cd-process-canvas .data=${canvas} @cd-action=${this.onCanvas}></cd-process-canvas>
            ${this.panel()}
          </div>`
        : this.phoneSources()}`;
  }
}
