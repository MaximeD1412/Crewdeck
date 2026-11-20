import { BREAKPOINT_PX, PageProcessEditor, t, type CdActionDetail, type ComposantData, type ComposantPayload } from '@crewdeck/sdk';
import { css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import { PasserelleElement, sharedStyles } from './base.js';

type Data = ComposantData<typeof PageProcessEditor>;
type Tab = Data['tab'];
type Step = NonNullable<Data['step']>;
type Phase = NonNullable<Data['phase']>;
type Row = Step['tools'][number];
type Attach = NonNullable<Data['attach']>;
type Input = Step['inputs'][number];
type PanelArrow = Input['arrows'][number];
type SourceRow = Data['sources']['rows'][number];
type SourceSelect = NonNullable<SourceRow['select']>;
type ForEach = Phase['repeat'][number]['forEach'];
type StepKind = ComposantPayload<typeof PageProcessEditor, 'addStep'>['kind'];
type Control = HTMLElement & { value: string };
type Choice = HTMLElement & { value: string; reset(): void };

/** The radio « Une fois »'s value: a Phase that does not repeat. */
const ONCE = 'once';

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
 *
 * Editable (`process-catalogue.html`, `process-phase.html`), the header holds
 * « Phase » and « Étape », the catalogue's Menu under the latter; a refusal
 * shows as the canvas's Toast; the Étape's panel moves it to another Phase or
 * removes it, the Phase's renames it, sets « Répéter » and removes it, through
 * a Dialog when it holds Étapes.
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
      .trailing {
        display: inline-flex;
        align-items: center;
        gap: var(--cd-space-1);
      }
      /* A Select of its own line under the row, its label shown. */
      .item .choose {
        grid-column: 2 / -1;
        width: auto;
        --cd-field-label-position: static;
        --cd-field-label-size: auto;
        --cd-field-label-overflow: visible;
        --cd-field-label-clip: none;
        --cd-field-label-white-space: normal;
      }
      .phone-sources {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
      }
      .header-actions {
        display: flex;
        align-items: center;
        gap: var(--cd-space-2);
      }
      .menu-anchor {
        position: relative;
        display: inline-flex;
      }
      .menu-anchor > cd-menu {
        position: absolute;
        top: calc(100% + var(--cd-space-2));
        right: 0;
        z-index: 5;
        /* Its own width (--cd-menu-width), not the anchor's: it opens leftwards over the panel. */
        max-width: none;
        /* Within the window, below the header: a long catalogue scrolls inside it. */
        max-height: calc(100dvh - 10rem);
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .radios {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-1);
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

  /** The name typed last sent by Enter, so that the `change` after it does not send it again. */
  private sentName: string | null = null;
  /** The last ask to focus the name that was honoured. */
  private focusedAt: number | null = null;
  /** Whether the catalogue was open when « Étape » was pressed: the Menu closes itself on that press, its click then opens nothing. A key or that click clears it. */
  private catalogueWasOpen = false;
  /** The same for « Attacher un Outil ». */
  private attachWasOpen = false;
  /** Bumped when a choice in the panel was refused: its controls, keyed on it, show the data again. */
  private resets = 0;

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    const at = this.data?.phase?.focusName ?? null;
    if (at === null || at === this.focusedAt) return;
    this.focusedAt = at;
    const field = this.shadowRoot?.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>('cd-text-field.phase-name');
    void field?.updateComplete.then(() => {
      const input = field.shadowRoot?.querySelector('input');
      input?.focus();
      input?.select();
    });
  }

  /** The canvas's `select` and `view` become the page's, its `moveStep`, `connect` and `loopBack` (`addLoopBack`) too. */
  private onCanvas(event: Event) {
    const { composant, action, payload } = (event as CustomEvent<CdActionDetail>).detail;
    if (composant !== 'ProcessCanvas') return;
    event.stopPropagation();
    if (action === 'select') this.emit('select', { target: (payload as { target: Data['gaps'][number]['target'] | null }).target, centre: false });
    if (action === 'view') this.emit('view', payload as { zoom: number; pan: { x: number; y: number } });
    if (action === 'moveStep') this.emit('moveStep', payload as { stepId: string; phaseId: string; col: number; row: number });
    if (action === 'connect') this.emit('connect', payload as ComposantPayload<typeof PageProcessEditor, 'connect'>);
    if (action === 'loopBack') this.emit('addLoopBack', payload as ComposantPayload<typeof PageProcessEditor, 'addLoopBack'>);
  }

  /** « Attacher un Outil »: a choice attaches its Outil, « Déclarer un Serveur MCP » opens the page Runner. */
  private onAttachMenu(attach: Attach, event: Event) {
    const { composant, action, payload } = (event as CustomEvent<CdActionDetail>).detail;
    if (composant !== 'Menu') return;
    event.stopPropagation();
    if (action === 'close') this.emit('closeMenu', {});
    if (action !== 'choose') return;
    const choice = attach.choices.find((candidate) => candidate.id === (payload as { id: string }).id);
    if (!choice) return;
    if (choice.tool === null) this.emit('openRunner', {});
    else this.emit('attachTool', { stepId: attach.stepId, tool: choice.tool });
  }

  private onLoopBackMax(step: Step, event: Event) {
    const { composant, action, payload } = (event as CustomEvent<CdActionDetail>).detail;
    if (composant !== 'Stepper') return;
    event.stopPropagation();
    if (action === 'change') this.emit('setLoopBackMax', { from: step.id, max: (payload as { value: number }).value });
  }

  /** « Alimentée par »: the Sortie chosen is connected, the Select back on its placeholder. */
  private onFeed(step: Step, input: Input, event: Event) {
    const control = event.currentTarget as Choice;
    const candidate = input.candidates?.[Number(control.value)];
    if (control.value !== '' && candidate) this.emit('connect', { from: candidate.from, to: { stepId: step.id, portId: input.id } });
    control.reset();
  }

  /** « Poser un Retour vers »: the Retour is asked for, the Select back on its placeholder. */
  private onLoopBackTarget(step: Step, event: Event) {
    const control = event.currentTarget as Choice;
    const to = step.loopBackTargets?.find((target) => target.value === control.value)?.value;
    if (to !== undefined) this.emit('addLoopBack', { from: step.id, to });
    control.reset();
  }

  private onMenu(event: Event) {
    const { composant, action, payload } = (event as CustomEvent<CdActionDetail>).detail;
    if (composant !== 'Menu') return;
    event.stopPropagation();
    if (action === 'close') this.emit('closeMenu', {});
    if (action === 'choose') this.emit('addStep', { kind: (payload as { id: StepKind }).id });
  }

  private onAttachButton(step: Step) {
    // As « Étape »'s: the press that closed the Menu opens nothing.
    const closing = this.attachWasOpen;
    this.attachWasOpen = false;
    if (closing) return;
    this.emit('openAttach', { stepId: step.id });
  }

  private onCatalogueButton() {
    // The press that closed the Menu ends here: the next click, from the keyboard too, opens it again.
    const closing = this.catalogueWasOpen;
    this.catalogueWasOpen = false;
    if (closing) return;
    this.emit('openCatalogue', {});
  }

  private onStepPhase(step: Step, event: Event) {
    const phaseId = (event.currentTarget as Control).value;
    if (phaseId !== step.phaseId) this.emit('moveStepToPhase', { stepId: step.id, phaseId });
    void this.resync();
  }

  /**
   * After a choice of the panel's controls, once the page's answer is shown:
   * a control still showing a choice its data does not (refused) is drawn
   * again from its data, the focus kept on it.
   */
  private async resync(): Promise<void> {
    await this.updateComplete;
    type Shown = HTMLElement & { value: string; checked?: boolean; data: { value: string; checked?: boolean } };
    const controls = [...this.renderRoot.querySelectorAll<Shown>('.radios cd-radio, cd-select.step-phase')];
    const stale = controls.some((control) =>
      control.localName === 'cd-radio' ? control.checked !== control.data.checked : control.value !== control.data.value,
    );
    if (!stale) return;
    const focused = controls.some((control) => control.matches(':focus-within'));
    this.resets += 1;
    this.requestUpdate();
    await this.updateComplete;
    if (!focused) return;
    const again = [...this.renderRoot.querySelectorAll<Shown & { updateComplete: Promise<unknown> }>('.radios cd-radio, cd-select.step-phase')].find(
      (control) => control.localName !== 'cd-radio' || control.data.checked,
    );
    await again?.updateComplete;
    again?.shadowRoot?.querySelector<HTMLElement>('input, select')?.focus();
  }

  private rename(phase: Phase, name: string) {
    if (name === phase.name && !phase.nameError) return;
    this.emit('renamePhase', { phaseId: phase.id, name });
  }

  private onNameKey(phase: Phase, event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const name = (event.currentTarget as Control).value;
    this.sentName = name;
    this.rename(phase, name);
  }

  private onNameChange(phase: Phase, event: Event) {
    const name = (event.currentTarget as Control).value;
    const sent = this.sentName;
    this.sentName = null;
    if (name !== sent) this.rename(phase, name);
  }

  private onRepeat(phase: Phase, event: Event) {
    const value = (event.target as Control).value;
    const forEach = (value === ONCE ? null : value) as ForEach;
    this.emit('setForEach', { phaseId: phase.id, forEach });
    void this.resync();
  }

  private onDialog(event: Event) {
    const { composant, action } = (event as CustomEvent<CdActionDetail>).detail;
    if (composant !== 'Dialog') return;
    event.stopPropagation();
    if (action === 'close') this.emit('cancelRemovePhase', {});
  }

  private onTabs(event: Event) {
    const { composant, action, payload } = (event as CustomEvent<CdActionDetail>).detail;
    if (composant !== 'Tabs' || action !== 'select') return;
    event.stopPropagation();
    const tab = (payload as { id?: unknown } | undefined)?.id;
    if (isTab(tab)) this.emit('tab', { tab });
  }

  /** An Outil of the Étape, « Détacher » on it while the canvas edits. */
  private row(step: Step, { icon, label, detail, tool, detachLabel }: Row): TemplateResult {
    const detach = this.data.canvas.editable
      ? html`<cd-icon-button class="detach" .data=${{ icon: 'x', label: detachLabel }} @click=${() => this.emit('detachTool', { stepId: step.id, tool })}></cd-icon-button>`
      : html`<span></span>`;
    return html`<div class="item" role="listitem">
      <cd-icon .data=${{ name: icon, size: 'sm' }}></cd-icon><b>${label}</b>${detach}
      ${detail === null ? nothing : html`<small>${detail}</small>`}
    </div>`;
  }

  /** « Retirer la flèche », one per arrow of a port, while the canvas edits. */
  private arrowButtons(arrows: PanelArrow[]): TemplateResult[] {
    if (!this.data.canvas.editable) return [];
    return arrows.map(
      (arrow) =>
        html`<cd-icon-button
          class="disconnect"
          .data=${{ icon: 'x', label: arrow.removeLabel }}
          @click=${() => this.emit('disconnect', { from: arrow.from, to: arrow.to })}
        ></cd-icon-button>`,
    );
  }

  private inputRow(step: Step, input: Input): TemplateResult {
    const editable = this.data.canvas.editable;
    const candidates = editable ? input.candidates : null;
    return html`<div class="item ${input.fed ? '' : 'caution'}" role="listitem">
      <cd-icon .data=${{ name: input.fed ? 'chevron-right' : 'alert', size: 'sm' }}></cd-icon><b>${input.label}</b
      ><span class="trailing"><span class="mono">${input.from}</span>${this.arrowButtons(input.arrows)}</span>
      ${candidates && candidates.length > 0
        ? html`<cd-select
            class="choose feed"
            .data=${{
              name: `feed.${input.id}`,
              label: t('process.arrow.fedBy'),
              value: '',
              options: [
                { value: '', label: t('process.arrow.choose'), disabled: true },
                ...candidates.map((candidate, index) => ({ value: String(index), label: candidate.label, disabled: false })),
              ],
              help: null,
              state: null,
            }}
            @change=${(event: Event) => this.onFeed(step, input, event)}
          ></cd-select>`
        : nothing}
    </div>`;
  }

  /** The Retour of an Étape: its sentence, « Au plus » and « Retirer le Retour »; or « Poser un Retour vers » for one that judges. */
  private loopBack(step: Step): TemplateResult | typeof nothing {
    const editable = this.data.canvas.editable;
    const title = t('process.step.loopBack.title');
    const { loopBack } = step;
    if (loopBack !== null) {
      return html`<section class="section loop-back" aria-label=${title}>
        <h2>${title}</h2>
        <p class="text">${loopBack.text}</p>
        ${editable
          ? html`<div class="cluster">
              <cd-stepper
                class="loop-back-max"
                .data=${{ label: t('process.loopBack.max'), value: loopBack.max, unit: t('process.loopBack.unit'), min: 1, max: 10 }}
                @cd-action=${(event: Event) => this.onLoopBackMax(step, event)}
              ></cd-stepper>
              <cd-button
                class="remove-loop-back"
                .data=${{ label: t('process.loopBack.remove'), variant: 'ghost', size: 'sm', icon: 'trash' }}
                @click=${() => this.emit('removeLoopBack', { from: step.id })}
              ></cd-button>
            </div>`
          : nothing}
      </section>`;
    }
    const targets = editable ? step.loopBackTargets : null;
    if (!targets || targets.length === 0) return nothing;
    return html`<section class="section loop-back" aria-label=${title}>
      <h2>${title}</h2>
      <cd-select
        class="loop-back-to"
        .data=${{
          name: 'loopBackTo',
          label: t('process.loopBack.add'),
          value: '',
          options: [{ value: '', label: t('process.loopBack.choose'), disabled: true }, ...targets.map((target) => ({ ...target, disabled: false }))],
          help: null,
          state: null,
        }}
        @change=${(event: Event) => this.onLoopBackTarget(step, event)}
      ></cd-select>
    </section>`;
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
    const editable = this.data.canvas.editable;
    return html`<div class="section">
        <div class="cluster">
          <cd-status-badge .data=${{ tone: 'accent', label: step.name }}></cd-status-badge>
          <span class="kind">${step.kindLabel} · ${step.phaseName}</span>
          ${editable
            ? html`<cd-button
                class="remove-step"
                .data=${{
                  label: t('process.step.remove'),
                  variant: 'ghost',
                  size: 'sm',
                  icon: 'trash',
                  ...(step.removeReason === null ? {} : { state: 'disabled' as const }),
                }}
                @click=${() => step.removeReason === null && this.emit('removeStep', { stepId: step.id })}
              ></cd-button>`
            : nothing}
        </div>
        ${editable && step.removeReason !== null ? html`<p class="text reason">${step.removeReason}</p>` : nothing}
        ${editable
          ? keyed(
              `${step.id}:${step.phaseId}:${this.resets}`,
              html`<cd-select
                class="step-phase"
                .data=${{
                  name: 'phaseId',
                  label: t('process.step.phase'),
                  value: step.phaseId,
                  options: step.phases.map((option) => ({ ...option, disabled: false })),
                  help: null,
                  state: null,
                }}
                @change=${(event: Event) => this.onStepPhase(step, event)}
              ></cd-select>`,
            )
          : nothing}
      </div>
      ${this.loopBack(step)}
      <details class="section ports" aria-label=${ports}>
        <summary>
          ${ports} <span class="count">${t('process.step.ports.count', { inputs: step.inputs.length, outputs: step.outputs.length })}</span>
          <cd-icon .data=${{ name: 'chevron-down', size: 'sm' }}></cd-icon>
        </summary>
        <div class="list" role="list">
          ${step.inputs.map((input) => this.inputRow(step, input))}
          ${step.outputs.map(
            (output) =>
              html`<div class="item" role="listitem">
                <cd-icon .data=${{ name: 'chevron-right', size: 'sm' }}></cd-icon><b>${output.label}</b
                ><span class="trailing"><span class="mono">${output.to}</span>${this.arrowButtons(output.arrows)}</span>
              </div>`,
          )}
        </div>
      </details>
      <section class="section tools" aria-label=${t('process.step.tools')}>
        <h2>${t('process.step.tools')}</h2>
        ${step.tools.length === 0
          ? html`<p class="text">${t('process.step.tools.none')}</p>`
          : html`<div class="list" role="list">${step.tools.map((tool) => this.row(step, tool))}</div>`}
        ${editable && step.canAttach
          ? html`<div class="cluster">
              <cd-button
                class="attach"
                aria-haspopup="menu"
                aria-expanded=${this.data.attach?.stepId === step.id ? 'true' : 'false'}
                .data=${{ label: t('process.tools.attach'), variant: 'secondary', size: 'sm', icon: 'plus' }}
                @pointerdown=${() => (this.attachWasOpen = this.data.attach !== null)}
                @keydown=${() => (this.attachWasOpen = false)}
                @click=${() => this.onAttachButton(step)}
              ></cd-button>
            </div>`
          : nothing}
      </section>`;
  }

  private phase(phase: Phase): TemplateResult {
    const editable = this.data.canvas.editable;
    const title = t('process.phase.repeat.title');
    const checked = phase.repeat.find((option) => option.checked);
    return html`<div class="section">
        <div class="cluster">
          <cd-status-badge .data=${{ tone: 'accent', label: t('process.phase.badge') }}></cd-status-badge>
          <span class="kind">${phase.count}</span>
        </div>
        ${keyed(
          phase.id,
          html`<cd-text-field
            class="phase-name"
            .data=${{
              name: 'name',
              label: t('process.phase.name'),
              value: phase.name,
              placeholder: null,
              help: null,
              error: phase.nameError,
              state: editable ? null : 'disabled',
              multiline: false,
              maxLength: null,
            }}
            @keydown=${(event: KeyboardEvent) => this.onNameKey(phase, event)}
            @change=${(event: Event) => this.onNameChange(phase, event)}
          ></cd-text-field>`,
        )}
      </div>
      <section class="section repeat" aria-label=${title}>
        <h2>${title}</h2>
        ${editable
          ? keyed(
              `${phase.id}:${this.resets}`,
              html`<div class="radios" role="radiogroup" aria-label=${title} @change=${(event: Event) => this.onRepeat(phase, event)}>
                ${phase.repeat.map(
                  (option) =>
                    html`<cd-radio
                      .data=${{ name: `repeat-${phase.id}`, value: option.forEach ?? ONCE, label: option.label, checked: option.checked }}
                    ></cd-radio>`,
                )}
              </div>`,
            )
          : html`<p class="text">${checked?.label ?? ''}</p>`}
        <p class="text help">${phase.help}</p>
      </section>
      ${editable
        ? html`<cd-button
            class="remove-phase"
            .data=${{
              label: t('process.phase.remove'),
              variant: 'ghost',
              size: 'sm',
              icon: 'trash',
              ...(phase.removeReason === null ? {} : { state: 'disabled' as const, disabledReason: phase.removeReason }),
            }}
            @click=${() => phase.removeReason === null && this.emit('removePhase', { phaseId: phase.id })}
          ></cd-button>`
        : nothing}`;
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

  /** The header's « Activer la v{n+1} », disabled with its reason; in the header's own actions while editing. */
  private activateButton(slotted: boolean) {
    const { activate } = this.data;
    if (!activate) return nothing;
    const disabled = activate.disabledReason !== null || activate.revision === null;
    const button = { label: activate.label, variant: 'primary', size: 'sm', icon: 'check' } as const;
    const data = disabled ? { ...button, state: 'disabled' as const, disabledReason: activate.disabledReason ?? undefined } : button;
    return html`<cd-button
      class="activate"
      slot=${slotted ? 'actions' : nothing}
      .data=${data}
      @click=${() => {
        if (!disabled && activate.revision !== null) this.emit('activate', { revision: activate.revision });
      }}
    ></cd-button>`;
  }

  private headerActions(): TemplateResult {
    const { catalogue } = this.data;
    return html`<div slot="actions" class="header-actions">
      <cd-button class="add-phase" .data=${{ label: t('process.header.phase'), variant: 'secondary', size: 'sm', icon: 'plus' }} @click=${() => this.emit('addPhase', {})}></cd-button>
      <span class="menu-anchor">
        <cd-button
          class="add-step"
          aria-haspopup="menu"
          aria-expanded=${catalogue ? 'true' : 'false'}
          .data=${{ label: t('process.header.step'), variant: 'secondary', size: 'sm', icon: 'plus' }}
          @pointerdown=${() => (this.catalogueWasOpen = this.data.catalogue !== null)}
          @keydown=${() => (this.catalogueWasOpen = false)}
          @click=${this.onCatalogueButton}
        ></cd-button>
        ${catalogue ? html`<cd-menu .data=${catalogue} @cd-action=${this.onMenu}></cd-menu>` : nothing}
      </span>
      ${this.activateButton(false)}
    </div>`;
  }

  private removePhaseDialog(): TemplateResult {
    const removing = this.data.removePhase;
    return html`<cd-dialog class="remove-phase-dialog" .data=${{ open: removing !== null, title: removing?.title ?? '' }} @cd-action=${this.onDialog}>
      ${removing ? html`<p class="text">${removing.body}</p>` : nothing}
      <cd-button
        slot="actions"
        class="cancel"
        .data=${{ label: t('process.phase.remove.cancel'), variant: 'ghost', size: 'md' }}
        @click=${() => this.emit('cancelRemovePhase', {})}
      ></cd-button>
      <cd-button
        slot="actions"
        class="confirm"
        .data=${{ label: t('process.phase.remove'), variant: 'danger', size: 'md', icon: 'trash' }}
        @click=${() => removing && this.emit('confirmRemovePhase', { phaseId: removing.phaseId })}
      ></cd-button>
    </cd-dialog>`;
  }

  protected override render() {
    const { found, title, hasVersion, canvas, toast, attach } = this.data;
    if (!found) {
      return html`<cd-empty class="not-found" .data=${{ icon: 'folder', title: t('process.notFound') }}
        ><a slot="actions" href="/projets">${t('process.notFound.back')}</a></cd-empty
      >`;
    }
    const editing = this.wide && canvas.editable;
    return html`<cd-page-header
        .data=${{ title: t('process.title'), count: title.count, back: { label: t('process.back', { projectName: title.projectName }), href: title.backHref } }}
        >${editing ? this.headerActions() : this.activateButton(true)}</cd-page-header
      >
      ${hasVersion ? nothing : html`<cd-banner .data=${{ tone: 'caution', icon: 'alert', title: t('process.noVersion') }}></cd-banner>`}
      ${this.wide
        ? html`<div class="editor" aria-label=${t('process.editor.label')} role="region">
            <cd-process-canvas .data=${canvas} @cd-action=${this.onCanvas}>
              ${toast ? html`<cd-toast slot="toast" .data=${toast}></cd-toast>` : nothing}
              ${attach && canvas.editable
                ? html`<cd-menu slot="menu" class="attach-menu" .data=${attach.menu} @cd-action=${(event: Event) => this.onAttachMenu(attach, event)}></cd-menu>`
                : nothing}
            </cd-process-canvas>
            ${this.panel()}
          </div>`
        : this.phoneSources()}
      ${canvas.editable ? this.removePhaseDialog() : nothing}`;
  }
}
