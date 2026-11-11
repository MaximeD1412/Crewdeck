import { formatHour, PageRunner, t, type ComposantData } from '@crewdeck/sdk';
import { css, html, nothing, type TemplateResult } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';
import { accountBadges, engineName, isConnected, modelBadge, modelReason } from './engine-accounts.js';
import { systemOf } from './runner-machine.js';

type Data = ComposantData<typeof PageRunner>;
type Runner = NonNullable<Data['runner']>;
type Engine = Data['engines'][number];

/**
 * `cd-page-runner` (`design/screens/crewdeck/runner.html`): the page's title,
 * then two columns from 1280 px, the aside first on a phone. The main one: the
 * Emplacement `usage`, « Moteurs et modèles » (a ListRow per model, its
 * Moteur and its Compte IA or why it is not usable; one row for a Moteur
 * without models), « Connecter un Compte IA » with its command. The aside:
 * the Runner card, its state badge, its machine and the encryption line.
 */
export class PasserellePageRunner extends PasserelleElement<typeof PageRunner> {
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
      .aside {
        order: -1;
      }
      @media (min-width: 1280px) {
        .layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) var(--cd-aside-width);
          gap: var(--cd-space-6);
          align-items: start;
        }
        .aside {
          order: 0;
        }
      }
      p {
        color: var(--cd-ink-2);
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
      }
      .connect-body {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
      }
      .crypto {
        display: flex;
        gap: var(--cd-space-2);
        align-items: flex-start;
        margin-top: var(--cd-space-3);
        color: var(--cd-muted);
      }
      .crypto cd-icon {
        color: var(--cd-go);
      }
    `,
  ];

  protected readonly composant = PageRunner;

  private engineRows(engine: Engine): TemplateResult[] {
    const name = engineName(engine.engine);
    if (engine.models.length === 0) {
      const [badge] = accountBadges(engine);
      return [
        html`<cd-list-row .data=${{ title: name, meta: t('aiAccounts.noModels') }}
          ><cd-status-badge slot="trailing" .data=${badge}></cd-status-badge
        ></cd-list-row>`,
      ];
    }
    const account = isConnected(engine) ? t(`aiAccounts.account.${engine.engine}`) : t('aiAccounts.state.loginRequired');
    return engine.models.map(
      (model) =>
        html`<cd-list-row .data=${{ title: model.id, meta: t('runner.modelMeta', { engine: name, detail: modelReason(model) ?? account }) }}
          ><cd-status-badge slot="trailing" .data=${modelBadge(model)}></cd-status-badge
        ></cd-list-row>`,
    );
  }

  private runnerCard(runner: Runner): TemplateResult {
    const online = runner.state === 'online';
    const title = t('runner.machine.title');
    return html`<cd-card class="runner" .data=${{ title, label: title }}>
      <cd-status-badge
        slot="actions"
        .data=${online ? { tone: 'go', label: t('runner.online') } : { tone: 'halt', label: t('runner.offline', { time: formatHour(runner.lastSeenAt) }) }}
      ></cd-status-badge>
      <cd-key-value
        .data=${{
          items: [
            { label: t('runner.machine.machine'), value: runner.machine, mono: false },
            { label: t('runner.machine.system'), value: systemOf(runner), mono: false },
            { label: t('runner.machine.version'), value: runner.runnerVersion, mono: false },
          ],
        }}
      ></cd-key-value>
      <p class="crypto"><cd-icon .data=${{ name: 'lock', size: 'sm' }}></cd-icon><span>${t('runner.encrypted')}</span></p>
    </cd-card>`;
  }

  protected override render() {
    const { engines, command, runner } = this.data;
    const enginesTitle = t('runner.engines.title');
    const connectTitle = t('runner.connect.title');
    return html`<cd-page-header .data=${{ title: t('runner.title') }}></cd-page-header>
      <div class="layout">
        <div class="main">
          <slot name="usage"></slot>
          <cd-card class="engines" .data=${{ title: enginesTitle, label: enginesTitle, flush: true }}>
            ${engines.flatMap((engine) => this.engineRows(engine))}
          </cd-card>
          <cd-card class="connect" .data=${{ title: connectTitle, label: connectTitle }}>
            <div class="connect-body">
              <p>${t('runner.connect.help')}</p>
              <cd-code-block .data=${{ code: command }}></cd-code-block>
            </div>
          </cd-card>
        </div>
        <div class="aside">${runner ? this.runnerCard(runner) : nothing}</div>
      </div>`;
  }
}
