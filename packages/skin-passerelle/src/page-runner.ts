import { formatHour, PageRunner, t, type ComposantData } from '@crewdeck/sdk';
import { css, html, nothing, type TemplateResult } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';
import { accountBadges, engineName, isConnected, modelBadge, modelReason } from './engine-accounts.js';
import { systemOf } from './runner-machine.js';

type Data = ComposantData<typeof PageRunner>;
type Runner = NonNullable<Data['runner']>;
type Engine = Data['engines'][number];
type McpServer = Data['mcpServers'][number];

/**
 * `cd-page-runner` (`design/screens/crewdeck/runner-serveurs-mcp.html`): the
 * page's title, then two columns from 1280 px, the aside first on a phone. The
 * main one: « Serveurs MCP » (a ListRow per server, its transport and its tool
 * count, « déclaré » or « en échec »), « Déclarer un Serveur MCP » with its
 * command, the Emplacement `usage`, « Moteurs et modèles » (a ListRow per model, its
 * Moteur and its Compte IA or why it is not usable; one row for a Moteur
 * without models; a row « version non vérifiée » above the models of a Moteur
 * whose version the adapter does not know), « Connecter un Compte IA » with its command. The aside:
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
    const [state, version] = accountBadges(engine);
    if (engine.models.length === 0) {
      return [
        html`<cd-list-row .data=${{ title: name, meta: t('aiAccounts.noModels') }}
          >${[state, version].map((badge) => (badge ? html`<cd-status-badge slot="trailing" .data=${badge}></cd-status-badge>` : nothing))}</cd-list-row
        >`,
      ];
    }
    // A version the adapter does not know heads its models (risk IA-3).
    const warning = version
      ? [
          html`<cd-list-row .data=${{ title: name, meta: t('runner.unknownVersionMeta') }}
            ><cd-status-badge slot="trailing" .data=${version}></cd-status-badge
          ></cd-list-row>`,
        ]
      : [];
    const account = isConnected(engine) ? t(`aiAccounts.account.${engine.engine}`) : t('aiAccounts.state.loginRequired');
    return [
      ...warning,
      ...engine.models.map(
        (model) =>
          html`<cd-list-row .data=${{ title: model.id, meta: t('runner.modelMeta', { engine: name, detail: modelReason(model) ?? account }) }}
            ><cd-status-badge slot="trailing" .data=${modelBadge(model)}></cd-status-badge
          ></cd-list-row>`,
      ),
    ];
  }

  private mcpRow(server: McpServer): TemplateResult {
    const transport = t(`runner.mcp.transport.${server.transport}`);
    const count = server.toolCount;
    const meta =
      count === null ? transport : t('runner.mcp.meta', { transport, tools: t(count <= 1 ? 'runner.mcp.tools.one' : 'runner.mcp.tools.other', { count }) });
    const badge = server.state === 'ready' ? { tone: 'go', label: t('runner.mcp.state.ready') } : { tone: 'halt', label: t('runner.mcp.state.failed') };
    return html`<cd-list-row .data=${{ title: server.name, meta, icon: 'layers' }}
      ><cd-status-badge slot="trailing" .data=${badge}></cd-status-badge
    ></cd-list-row>`;
  }

  private mcpCards(servers: Data['mcpServers']): TemplateResult {
    const title = t('runner.mcp.title');
    const declareTitle = t('runner.mcp.declare.title');
    return html`<cd-card class="mcp" .data=${{ title, count: servers.length, label: title, ...(servers.length > 0 ? { flush: true } : {}) }}>
        ${servers.length > 0 ? servers.map((server) => this.mcpRow(server)) : html`<p>${t('runner.mcp.empty')}</p>`}
      </cd-card>
      <cd-card class="mcp-declare" .data=${{ title: declareTitle, label: declareTitle }}>
        <div class="connect-body">
          <p>${t('runner.mcp.declare.help')}</p>
          <cd-code-block .data=${{ code: t('runner.mcp.declare.command') }}></cd-code-block>
        </div>
      </cd-card>`;
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
    const { engines, command, runner, mcpServers } = this.data;
    const enginesTitle = t('runner.engines.title');
    const connectTitle = t('runner.connect.title');
    return html`<cd-page-header .data=${{ title: t('runner.title') }}></cd-page-header>
      <div class="layout">
        <div class="main">
          ${this.mcpCards(mcpServers)}
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
