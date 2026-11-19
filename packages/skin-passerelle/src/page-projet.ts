import { formatDateOfAnyYear, PageProjet, t, type ComposantData } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

type Data = ComposantData<typeof PageProjet>;
type Row = Data['readiness']['rows'][number];

/** A check's icon and tone: ok go, missing caution, pending neutral. */
const LOOK = {
  ok: { icon: 'check', tone: 'go' },
  missing: { icon: 'alert', tone: 'caution' },
  pending: { icon: 'clock', tone: 'neutral' },
} as const;

/** The KeyValue rows of the Card « Projet »: its Dépôt GitHub, its folder (never its path), its Connecteurs, since when. */
const rows = ({ fullName, folder, connectors, followedAt }: Data): { label: string; value: string; mono: boolean }[] => [
  ...(fullName === null ? [] : [{ label: t('projets.projet.row.repository'), value: fullName, mono: false }]),
  ...(folder === null
    ? []
    : [
        {
          label: t('projets.projet.row.folder'),
          value: t(`projets.projet.folder.${folder.state}`, { machine: folder.machine ?? t('projets.local.thisMachine') }),
          mono: false,
        },
      ]),
  {
    label: t('projets.projet.row.connectors'),
    value: connectors.length === 0 ? t('projets.projet.connectors.none') : connectors.map((kind) => t(`projets.projet.connector.${kind}`)).join(', '),
    mono: false,
  },
  { label: t('projets.projet.row.followedAt'), value: formatDateOfAnyYear(followedAt), mono: false },
];

/**
 * `cd-page-projet` (`design/screens/crewdeck/projet*.html`): the PageHeader
 * of the Projet's name, back to « Projets », its readiness's count, with
 * « Gestion du process » (`openProcess`) and « Paramètres du Projet »
 * (`openSettings`); the caution Banner « Le Process ne peut pas démarrer »
 * while a check is missing; then the flush Card « Ce dont le Process a
 * besoin », a ListRow per check, « Corriger » (`fix`) on a point fixed on one
 * click, else its badge, the row a link where it is fixed elsewhere; beside
 * it from 1280 px, under it on a phone, the Card « Projet » and, for a Local
 * Projet, the neutral Banner « Des fichiers que tu lis à la main ».
 */
export class PasserellePageProjet extends PasserelleElement<typeof PageProjet> {
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
      .aside {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-4);
        min-width: 0;
      }
      @media (min-width: 1280px) {
        .layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) var(--cd-aside-width);
          gap: var(--cd-space-6);
          align-items: start;
        }
      }
    `,
  ];

  protected readonly composant = PageProjet;

  private trailing(row: Row, fixing: Data['readiness']['fixing']) {
    if (row.fix) {
      return html`<cd-button
        slot="trailing"
        .data=${{ label: t('projet.readiness.fix'), variant: 'primary', size: 'sm', ...(fixing === row.id ? { state: 'loading' } : {}) }}
        @click=${() => this.emit('fix', { checkId: row.id })}
      ></cd-button>`;
    }
    const { tone } = LOOK[row.state];
    return html`<cd-status-badge slot="trailing" .data=${{ tone, label: t(`projet.readiness.badge.${row.state}`) }}></cd-status-badge>`;
  }

  private readiness({ rows, fixing }: Data['readiness']) {
    return html`<cd-card class="readiness" .data=${{ title: t('projet.readiness.card'), label: t('projet.readiness.card'), flush: true }}>
      ${rows.map(
        (row) =>
          html`<cd-list-row
            data-check=${row.id}
            .data=${{ title: row.title, meta: row.meta, ...LOOK[row.state], ...(row.href === null ? {} : { href: row.href }) }}
            >${this.trailing(row, fixing)}</cd-list-row
          >`,
      )}
    </cd-card>`;
  }

  protected override render() {
    const { name, folder, readiness } = this.data;
    return html`<cd-page-header .data=${{ title: name, count: readiness.count, back: { label: t('projets.projet.back'), href: '/projets' } }}
        ><cd-button
          class="process"
          slot="actions"
          .data=${{ label: t('projets.projet.process'), variant: 'secondary', size: 'md', icon: 'layers' }}
          @click=${() => this.emit('openProcess', {})}
        ></cd-button
        ><cd-button
          class="settings"
          slot="actions"
          .data=${{ label: t('projets.projet.settings'), variant: 'secondary', size: 'md', icon: 'settings' }}
          @click=${() => this.emit('openSettings', {})}
        ></cd-button
      ></cd-page-header>
      ${readiness.blocked === null
        ? nothing
        : html`<cd-banner class="blocked" .data=${{ tone: 'caution', icon: 'alert', title: t('projet.readiness.blocked.title') }}>${readiness.blocked}</cd-banner>`}
      <div class="layout">
        ${readiness.rows.length === 0 ? nothing : this.readiness(readiness)}
        <div class="aside">
          <cd-card class="projet" .data=${{ title: t('projets.projet.card'), label: t('projets.projet.card') }}>
            <cd-key-value .data=${{ items: rows(this.data) }}></cd-key-value>
          </cd-card>
          ${folder === null
            ? nothing
            : html`<cd-banner class="files" .data=${{ tone: 'neutral', icon: 'folder', title: t('projets.local.banner.title') }}>${t('projets.local.banner.text')}</cd-banner>`}
        </div>
      </div>`;
  }
}
