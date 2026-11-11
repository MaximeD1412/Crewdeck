import {
  DEMARRAGE_SYSTEMS,
  formatRelative,
  PageDemarrage,
  t,
  zDemarrageSystem,
  type CdActionDetail,
  type ComposantData,
} from '@crewdeck/sdk';
import { css, html, nothing, type TemplateResult } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

type Data = ComposantData<typeof PageDemarrage>;
type Runner = NonNullable<Data['runner']>;
type StepState = 'done' | 'current' | 'todo' | 'halt';

const STEPS = ['runner', 'ai-accounts', 'projects'] as const;

/** The track: the steps before the Pilote's done, theirs current (halt after a failed link); the Runner linked, the Comptes IA come next. */
const track = ({ step, failure, runner }: Data): { label: string; meta: null; state: StepState }[] => {
  const at = step === 'runner' && runner ? 1 : STEPS.indexOf(step);
  return STEPS.map((id, index) => ({
    label: t(`demarrage.step.${id}`),
    meta: null,
    state: index < at ? 'done' : index > at ? 'todo' : step === 'runner' && failure && !runner ? 'halt' : 'current',
  }));
};

/** « Windows (WSL) · amd64 », « macOS · arm64 ». */
const systemOf = ({ os, arch, wsl }: Runner): string =>
  t('demarrage.runner.systemArch', { system: t(`demarrage.runner.system.${wsl ? 'wsl' : os === 'darwin' ? 'macos' : 'linux'}`), arch });

/**
 * `cd-page-demarrage` (`design/screens/crewdeck/demarrage*.html`): the
 * compact track of « Premiers pas », the step's title and lead, then the
 * step. The Runner's: the systems' Tabs (`selectSystem`), the tab's help, the
 * CodeBlock of the command and either the waiting CheckRow and « Ce qui reste
 * chez toi », or, after a failure, the halt Banner of its reason above them
 * and « Réessayer » (`retry`) below; once linked, the go Banner, « Ta
 * machine » and « Continuer » (`continue`). The Comptes IA and the Projets:
 * an Empty and « Continuer ».
 */
export class PasserellePageDemarrage extends PasserelleElement<typeof PageDemarrage> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-5);
        padding-top: var(--cd-space-6);
      }
      .head {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
      }
      section {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-5);
      }
      .system {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-3);
      }
      p {
        color: var(--cd-ink-2);
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
      }
      .muted {
        color: var(--cd-muted);
      }
      .waiting {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
      }
      .yours cd-list-row::part(row) {
        padding-left: 0;
        padding-right: 0;
      }
      .actions {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
      }
      .actions cd-button::part(button) {
        width: 100%;
      }
    `,
  ];

  protected readonly composant = PageDemarrage;

  /** The Tabs' `select` becomes the page's `selectSystem`. */
  private selectSystem(event: Event) {
    const detail = (event as CustomEvent<CdActionDetail>).detail;
    if (detail.composant !== 'Tabs' || detail.action !== 'select') return;
    event.stopPropagation();
    const system = zDemarrageSystem.safeParse((detail.payload as { id?: unknown } | undefined)?.id);
    if (system.success) this.emit('selectSystem', { system: system.data });
  }

  private button(className: string, label: string, icon: 'refresh' | undefined, onClick: () => void): TemplateResult {
    const { busy } = this.data;
    return html`<div class="actions">
      <cd-button
        class=${className}
        .data=${{ label, variant: 'primary', size: 'md', ...(icon ? { icon } : {}), ...(busy ? { state: 'loading' } : {}) }}
        @click=${() => {
          if (!this.data.busy) onClick();
        }}
      ></cd-button>
    </div>`;
  }

  private head(title: string, lead: string): TemplateResult {
    return html`<div class="head">
      <cd-page-header .data=${{ title }}></cd-page-header>
      <p part="lead">${lead}</p>
    </div>`;
  }

  /** The Tabs, the tab's help and the command; nothing of the command before the page drew its code. */
  private install(): TemplateResult {
    const { system, command } = this.data;
    return html`<div class="system">
      <cd-tabs
        .data=${{ tabs: DEMARRAGE_SYSTEMS.map((id) => ({ id, label: t(`demarrage.runner.system.${id}`), selected: id === system })) }}
        @cd-action=${this.selectSystem}
      ></cd-tabs>
      <p class="help muted">${t(`demarrage.runner.help.${system}`)}</p>
      ${command === null ? nothing : html`<cd-code-block .data=${{ code: command }}></cd-code-block>`}
    </div>`;
  }

  private runnerStep(): TemplateResult {
    const { failure, shortId, runner, login } = this.data;
    if (runner) {
      const online = runner.state === 'online';
      return html`${this.head(t('demarrage.runner.linked.title'), t(online ? 'demarrage.runner.linked.lead' : 'demarrage.runner.linked.leadOffline', { login }))}
        <section aria-label=${t('demarrage.step.runner')}>
          <cd-banner .data=${online ? { tone: 'go', icon: 'check', title: t('demarrage.runner.online.title') } : { tone: 'caution', icon: 'wifi', title: t('demarrage.runner.offline.title') }}
            >${online ? t('demarrage.runner.online.text', { ago: formatRelative(runner.lastSeenAt) }) : t('demarrage.runner.offline.text')}</cd-banner
          >
          <cd-card .data=${{ title: t('demarrage.runner.machine.title') }}>
            <cd-key-value
              .data=${{
                items: [
                  { label: t('demarrage.runner.machine.machine'), value: runner.machine, mono: false },
                  { label: t('demarrage.runner.machine.system'), value: systemOf(runner), mono: false },
                  { label: t('demarrage.runner.machine.version'), value: t('demarrage.runner.version', { version: runner.runnerVersion }), mono: false },
                ],
              }}
            ></cd-key-value>
          </cd-card>
          ${this.button('continue', t('demarrage.continue'), undefined, () => this.emit('continue', {}))}
        </section>`;
    }
    if (failure) {
      const reason = failure.reason;
      const lead = reason === 'unsupported-system' ? 'demarrage.runner.failed.leadUnsupported' : 'demarrage.runner.failed.lead';
      return html`${this.head(t('demarrage.runner.failed.title'), t(lead))}
        <section aria-label=${t('demarrage.step.runner')}>
          <cd-banner .data=${{ tone: 'halt', icon: 'alert', title: t(`demarrage.runner.failure.${reason}.title`) }}
            >${t(`demarrage.runner.failure.${reason}.text`, { shortId: failure.shortId })}</cd-banner
          >
          ${this.install()} ${this.button('retry', t('demarrage.runner.retry'), 'refresh', () => this.emit('retry', {}))}
          <p class="muted">${t('demarrage.runner.retryHelp')}</p>
        </section>`;
    }
    return html`${this.head(t('demarrage.runner.title'), t('demarrage.runner.lead'))}
      <section aria-label=${t('demarrage.step.runner')}>
        ${this.install()}
        <cd-card .data=${{}}>
          <div class="waiting">
            <cd-check-row
              .data=${{ name: t('demarrage.runner.waiting'), state: 'running', detail: shortId ? t('demarrage.runner.code', { shortId }) : null, href: null }}
            ></cd-check-row>
            <p>${t('demarrage.runner.waitingHelp')}</p>
          </div>
        </cd-card>
      </section>
      <cd-card class="yours" .data=${{ title: t('demarrage.runner.yours.title'), label: t('demarrage.runner.yours.title') }}>
        ${(['machine', 'encrypted', 'keys'] as const).map(
          (id) =>
            html`<cd-list-row
              .data=${{
                icon: id === 'machine' ? 'server' : id === 'encrypted' ? 'lock' : 'key',
                title: t(`demarrage.runner.yours.${id}.title`),
                meta: t(`demarrage.runner.yours.${id}.meta`),
              }}
            ></cd-list-row>`,
        )}
      </cd-card>`;
  }

  /** The Comptes IA and the Projets, until their tickets: an Empty and « Continuer ». */
  private comingStep(step: 'aiAccounts' | 'projects'): TemplateResult {
    return html`${this.head(t(`demarrage.${step}.title`), t(`demarrage.${step}.lead`))}
      <section aria-label=${t(step === 'aiAccounts' ? 'demarrage.step.ai-accounts' : 'demarrage.step.projects')}>
        <cd-empty .data=${{ icon: step === 'aiAccounts' ? 'key' : 'folder', title: t(`demarrage.${step}.empty.title`) }}
          >${t(`demarrage.${step}.empty.text`)}</cd-empty
        >
        ${this.button('continue', t('demarrage.continue'), undefined, () => this.emit('continue', {}))}
      </section>`;
  }

  protected override render() {
    const { step } = this.data;
    return html`<nav part="steps" aria-label=${t('demarrage.steps')}>
        <cd-process-track .data=${{ direction: 'compact', steps: track(this.data) }}></cd-process-track>
      </nav>
      ${step === 'runner' ? this.runnerStep() : this.comingStep(step === 'ai-accounts' ? 'aiAccounts' : 'projects')}`;
  }
}
