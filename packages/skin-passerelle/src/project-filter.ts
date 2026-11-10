import { ProjectFilter, t } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/** `cd-project-filter`: the Projects' chips under a page's title; a click emits `select`, `null` for « Tous les Projets ». */
export class PasserelleProjectFilter extends PasserelleElement<typeof ProjectFilter> {
  static override styles = [
    sharedStyles,
    css`
      div {
        display: flex;
        gap: var(--cd-space-2);
        overflow-x: auto;
        padding: var(--cd-space-1) 0;
        scrollbar-width: none;
      }
    `,
  ];

  protected readonly composant = ProjectFilter;

  protected override render() {
    return html`<div part="chips" role="group" aria-label=${t('projectFilter.label')}>
      ${this.data.chips.map(
        (chip) =>
          html`<cd-chip
            .data=${{ label: chip.label, count: chip.count, selected: chip.selected }}
            @click=${() => this.emit('select', { projectId: chip.projectId })}
          ></cd-chip>`,
      )}
    </div>`;
  }
}
