import { PageAjouterProjet, PROJECT_ORIGINS, t, zProjectOrigin, type CdActionDetail } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-page-ajouter-projet` (`design/screens/crewdeck/demarrage-projets.html`,
 * under its PageHeader): « Ajouter un Projet » back to « Projets », the Tabs
 * « Dossier sur ta machine » and « Dépôt GitHub » (their `select` becoming
 * `selectTab`), then the FolderProjectForm of `folder` or the
 * RepositoryPicker of `picker`, whose actions go on up to the page's
 * dispatcher. With `repick`, « Choisir le dossier de <name> » over the
 * `repick` form only.
 */
export class PasserellePageAjouterProjet extends PasserelleElement<typeof PageAjouterProjet> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-5);
        min-width: 0;
      }
    `,
  ];

  protected readonly composant = PageAjouterProjet;

  /** The Tabs' `select` becomes the page's `selectTab`. */
  private onTabs(event: Event) {
    const detail = (event as CustomEvent<CdActionDetail>).detail;
    if (detail.composant !== 'Tabs' || detail.action !== 'select') return;
    event.stopPropagation();
    const tab = zProjectOrigin.safeParse((detail.payload as { id?: unknown } | undefined)?.id);
    if (tab.success) this.emit('selectTab', { id: tab.data });
  }

  protected override render() {
    const { tab, folder, picker, repick } = this.data;
    const back = { label: t('projets.ajouter.back'), href: '/projets' };
    if (repick) {
      return html`<cd-page-header .data=${{ title: t('projets.ajouter.repick', { name: repick.name }), back }}></cd-page-header>
        <cd-folder-project-form .data=${{ ...folder, context: 'repick', name: repick.name }}></cd-folder-project-form>`;
    }
    return html`<cd-page-header .data=${{ title: t('projets.ajouter.title'), back }}></cd-page-header>
      <cd-tabs
        .data=${{ tabs: PROJECT_ORIGINS.map((id) => ({ id, label: t(`projets.ajouter.tab.${id}`), selected: id === tab })) }}
        @cd-action=${this.onTabs}
      ></cd-tabs>
      ${tab === 'dossier'
        ? html`<cd-folder-project-form .data=${folder}></cd-folder-project-form>`
        : html`<cd-repository-picker .data=${picker}></cd-repository-picker>`}`;
  }
}
