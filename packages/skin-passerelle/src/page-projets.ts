import { PageProjets, t, type ComposantData } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

type Tone = ComposantData<typeof PageProjets>['projects'][number]['tone'];

/** A Projet's icon by its readiness's tone: prêt, à régler, inventaire, en cours. */
const ICONS: Readonly<Record<Tone, 'check' | 'alert' | 'doc' | 'clock' | 'block'>> = { go: 'check', caution: 'alert', accent: 'doc', neutral: 'clock', halt: 'block' };

/**
 * `cd-page-projets` (`design/screens/crewdeck/projets*.html`): the page's
 * title, its count and « Ajouter un Projet » (`add`), then the flush Card
 * « Prêts pour le Process ? », a ListRow per Projet, its name over its `meta`
 * (its Dépôt GitHub, or where its folder is, or the point to fix), a link to
 * its page, its readiness's icon and badge. Without any, the Card holds the
 * Empty and its « Ajouter un Projet ».
 */
export class PasserellePageProjets extends PasserelleElement<typeof PageProjets> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-4);
        min-width: 0;
      }
    `,
  ];

  protected readonly composant = PageProjets;

  private add(className: string, slot: string) {
    return html`<cd-button
      class=${className}
      slot=${slot}
      .data=${{ label: t('projets.add'), variant: 'primary', size: 'md', icon: 'plus' }}
      @click=${() => this.emit('add', {})}
    ></cd-button>`;
  }

  protected override render() {
    const { projects } = this.data;
    const count = projects.length;
    if (count === 0) {
      return html`<cd-page-header .data=${{ title: t('projets.title') }}></cd-page-header>
        <cd-card .data=${{ label: t('projets.title') }}>
          <cd-empty .data=${{ icon: 'folder', title: t('projets.empty.title') }}>${t('projets.empty.text')}${this.add('add', 'actions')}</cd-empty>
        </cd-card>`;
    }
    return html`<cd-page-header .data=${{ title: t('projets.title'), count: count === 1 ? t('projets.count.one') : t('projets.count.many', { count }) }}
        >${this.add('add', 'actions')}</cd-page-header
      >
      <cd-card .data=${{ title: t('projets.list.title'), label: t('projets.title'), flush: true }}>
        ${projects.map(
          (project) =>
            html`<cd-list-row
              data-project=${project.id}
              .data=${{ title: project.name, meta: project.meta, icon: ICONS[project.tone], tone: project.tone, href: `/projets/${project.id}` }}
              ><cd-status-badge slot="trailing" .data=${{ tone: project.tone, label: project.badge }}></cd-status-badge
            ></cd-list-row>`,
        )}
      </cd-card>`;
  }
}
