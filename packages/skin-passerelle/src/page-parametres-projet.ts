import { PageParametresProjet, PROJECT_SETTINGS_SECTIONS, t, type ProjectSettingsSection } from '@crewdeck/sdk';
import { html, type TemplateResult } from 'lit';
import { PasserelleSettingsPage } from './page-parametres.js';

/** Each section's anchor, the French of its page's URL (`/projets/:id/parametres#etapes`). */
const ANCHORS: Readonly<Record<ProjectSettingsSection, string>> = {
  roles: 'roles',
  steps: 'etapes',
  branches: 'branches',
  worktree: 'worktree',
  schedules: 'planifications',
  notifications: 'notifications',
};

/**
 * `cd-page-parametres-projet`: the Paramètres of one Projet, laid out as the
 * account's (`PasserelleSettingsPage`): the Projet's name in the header, the
 * count of its settings changed, back to the account's Paramètres, the
 * accent Banner saying it inherits from the account, then the nav of its
 * filled sections, each with the count it changed, and their Emplacements.
 */
export class PasserellePageParametresProjet extends PasserelleSettingsPage<typeof PageParametresProjet, ProjectSettingsSection> {
  protected readonly composant = PageParametresProjet;
  protected readonly sections = PROJECT_SETTINGS_SECTIONS;
  protected readonly anchors = ANCHORS;

  protected navLabel(): string {
    return t('settings.project.nav');
  }

  protected head(): TemplateResult {
    const { project, changedCount } = this.data;
    const count =
      changedCount === 0
        ? t('settings.project.count.none')
        : t(changedCount === 1 ? 'settings.project.count.one' : 'settings.project.count.other', { count: changedCount });
    return html`<cd-page-header .data=${{ title: project, count, back: { label: t('settings.project.back'), href: '/parametres' } }}></cd-page-header>
      <cd-banner .data=${{ tone: 'accent', icon: 'info', title: t('settings.project.banner.title') }}>${t('settings.project.banner.body')}</cd-banner>`;
  }

  protected link(section: ProjectSettingsSection): unknown {
    const count = this.data.counts[section] ?? 0;
    const label = t(`settings.project.section.${section}`);
    if (count === 0) return label;
    // The count is read once, as words: « Rôles et modèles, 2 modifiés ».
    const words = t(count === 1 ? 'settings.project.sectionCount.one' : 'settings.project.sectionCount.other', { count });
    return html`${label}
      <span class="n" part="count"><span aria-hidden="true">${count}</span><span class="visually-hidden">, ${words}</span></span>`;
  }

  protected changed(name: string, value: string | boolean): void {
    this.emit('change', { name, value });
  }
}
