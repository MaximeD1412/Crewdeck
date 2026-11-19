import { NoteIdeaDialog, t, type CdActionDetail } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

type Control = HTMLElement & { value: string };

/** The longest text the core takes, as its action declares it. */
const TEXT_MAX = NoteIdeaDialog.actions.submit.shape.text.maxLength;

/**
 * `cd-note-idea-dialog` (`design/screens/crewdeck/idees-nouvelle.html`): a
 * Dialog « Noter une Idée » with « Ton Idée, en une phrase », the Select
 * « Projet » (« Laisser l’analyse choisir » first, the value `''`), the note
 * on the analysis to come, « Annuler » and « Noter ». Ctrl or ⌘ + Enter in
 * the text notes too; Escape, a click beside or « Annuler » cancel, except
 * while `busy`. Its fields are new at each opening (rendered only while
 * open). `locked`: no field, the reason and a link to « Paramètres », which
 * emits `cancel` as it leads there. The
 * text goes as typed: the core trims, refuses an empty one and seals it.
 */
export class PasserelleNoteIdeaDialog extends PasserelleElement<typeof NoteIdeaDialog> {
  static override styles = [
    sharedStyles,
    css`
      .note {
        margin: 0;
        color: var(--cd-muted);
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height) var(--cd-font-body-sm-family),
          sans-serif;
      }
      .locked {
        margin: 0;
      }
    `,
  ];

  protected readonly composant = NoteIdeaDialog;

  private onDialog(event: Event) {
    event.stopPropagation();
    if ((event as CustomEvent<CdActionDetail>).detail.action === 'close') this.cancel();
  }

  private cancel() {
    if (!this.data.busy) this.emit('cancel', {});
  }

  private submit() {
    const { busy, locked } = this.data;
    if (busy || locked) return;
    const root = this.shadowRoot;
    const text = root?.querySelector<Control>('cd-text-field.text')?.value ?? '';
    const project = root?.querySelector<Control>('cd-select.project')?.value ?? '';
    this.emit('submit', { text, projectId: project === '' ? null : project });
  }

  private onTextKey(event: KeyboardEvent) {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    this.submit();
  }

  private fields() {
    const { projects, defaultProjectId, error } = this.data;
    const chosen = projects.some((project) => project.id === defaultProjectId) ? (defaultProjectId ?? '') : '';
    return html`<cd-text-field
        class="text"
        .data=${{
          name: 'text',
          label: t('idees.dialog.text'),
          value: '',
          placeholder: null,
          help: null,
          error,
          state: null,
          multiline: true,
          maxLength: TEXT_MAX,
        }}
        @keydown=${this.onTextKey}
      ></cd-text-field>
      <cd-select
        class="project"
        .data=${{
          name: 'projectId',
          label: t('idees.dialog.project'),
          value: chosen,
          options: [
            { value: '', label: t('idees.dialog.anyProject'), disabled: false },
            ...projects.map((project) => ({ value: project.id, label: project.name, disabled: false })),
          ],
          help: t('idees.dialog.projectHelp'),
          state: null,
        }}
      ></cd-select>
      <p class="note">${t('idees.dialog.note')}</p>`;
  }

  private locked() {
    return html`<p class="locked">${t('idees.dialog.locked')} <a href="/parametres" @click=${this.cancel}>${t('idees.dialog.lockedLink')}</a></p>`;
  }

  protected override render() {
    const { open, busy, locked } = this.data;
    return html`<cd-dialog .data=${{ open, title: t('idees.dialog.title') }} @cd-action=${this.onDialog}>
      ${open ? (locked ? this.locked() : this.fields()) : nothing}
      <cd-button slot="actions" class="cancel" .data=${{ label: t('idees.dialog.cancel'), variant: 'ghost', size: 'md' }} @click=${this.cancel}></cd-button>
      ${locked
        ? nothing
        : html`<cd-button
            slot="actions"
            class="submit"
            .data=${{ label: t('idees.dialog.submit'), variant: 'primary', size: 'md', icon: 'check', ...(busy ? { state: 'loading' as const } : {}) }}
            @click=${this.submit}
          ></cd-button>`}
    </cd-dialog>`;
  }
}
