import { formatDateOfAnyYear, PageProjet, t, type ComposantData } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

type Data = ComposantData<typeof PageProjet>;

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
 * `cd-page-projet` (`design/screens/crewdeck/projet-local.html`): the
 * PageHeader of the Projet's name, back to « Projets », with « Gestion du
 * process » (`openProcess`); then, in one column, the Card « Projet » and, for
 * a Local Projet, the neutral Banner « Des fichiers que tu lis à la main ».
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
      .layout {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-4);
        min-width: 0;
      }
    `,
  ];

  protected readonly composant = PageProjet;

  protected override render() {
    const { name, folder } = this.data;
    return html`<cd-page-header .data=${{ title: name, back: { label: t('projets.projet.back'), href: '/projets' } }}
        ><cd-button
          class="process"
          slot="actions"
          .data=${{ label: t('projets.projet.process'), variant: 'secondary', size: 'md', icon: 'layers' }}
          @click=${() => this.emit('openProcess', {})}
        ></cd-button
      ></cd-page-header>
      <div class="layout">
        <cd-card .data=${{ title: t('projets.projet.card'), label: t('projets.projet.card') }}>
          <cd-key-value .data=${{ items: rows(this.data) }}></cd-key-value>
        </cd-card>
        ${folder === null
          ? nothing
          : html`<cd-banner .data=${{ tone: 'neutral', icon: 'folder', title: t('projets.local.banner.title') }}>${t('projets.local.banner.text')}</cd-banner>`}
      </div>`;
  }
}
