import { PROCESS_TEMPLATE_NAME_MAX, ProcessTemplateList, t, type CdActionDetail, type ComposantData } from '@crewdeck/sdk';
import { css, html, nothing, type TemplateResult } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

type Data = ComposantData<typeof ProcessTemplateList>;
type Template = Data['templates'][number];
type Control = HTMLElement & { value: string };

/**
 * `cd-process-template-list`, the card « Modèles de process » of the
 * Paramètres (no mockup: the Card, ListRow, Button and Empty of the page's
 * other cards): its count, a ListRow per Modèle (`layers`, its name, its
 * meta) with « Renommer » and « Supprimer » trailing, stacked below 1280 px;
 * none, its Empty. The
 * Dialog « Renommer le Modèle de process » holds the name (new at each
 * opening, Enter submits) and the server's error under it; the Dialog
 * « Supprimer… ? » asks before `confirmRemove`. The actions of the
 * Composants it places stay inside.
 */
export class PasserelleProcessTemplateList extends PasserelleElement<typeof ProcessTemplateList> {
  static override styles = [
    sharedStyles,
    css`
      /* Below 1280 px the two buttons stack, so the name and its meta keep the row's width. */
      .trailing {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: var(--cd-space-1);
      }
      @media (min-width: 1280px) {
        .trailing {
          flex-direction: row;
          align-items: center;
        }
      }
      .text {
        margin: 0;
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
        color: var(--cd-ink-2);
      }
    `,
  ];

  protected readonly composant = ProcessTemplateList;

  private stop(event: Event) {
    event.stopPropagation();
  }

  private onDialog(event: Event) {
    event.stopPropagation();
    if ((event as CustomEvent<CdActionDetail>).detail.action === 'close') this.emit('cancel', {});
  }

  private submitRename() {
    const { renaming } = this.data;
    if (!renaming) return;
    const name = this.shadowRoot?.querySelector<Control>('cd-text-field.name')?.value ?? renaming.name;
    this.emit('submitRename', { id: renaming.id, name });
  }

  private onNameKey(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.submitRename();
  }

  private row(template: Template): TemplateResult {
    return html`<cd-list-row data-template=${template.id} .data=${{ title: template.name, meta: template.meta, icon: 'layers' }}>
      <div slot="trailing" class="trailing">
        <cd-button
          class="rename"
          .data=${{ label: t('settings.processTemplates.rename'), variant: 'ghost', size: 'sm' }}
          @click=${() => this.emit('rename', { id: template.id })}
        ></cd-button>
        <cd-button
          class="remove"
          .data=${{ label: t('settings.processTemplates.remove'), variant: 'ghost', size: 'sm', icon: 'trash' }}
          @click=${() => this.emit('remove', { id: template.id })}
        ></cd-button>
      </div>
    </cd-list-row>`;
  }

  private empty(): TemplateResult {
    return html`<cd-empty .data=${{ icon: 'layers', title: t('settings.processTemplates.empty.title') }}>${t('settings.processTemplates.empty.text')}</cd-empty>`;
  }

  private renameDialog(): TemplateResult {
    const { renaming } = this.data;
    return html`<cd-dialog class="renaming" .data=${{ open: renaming !== null, title: t('settings.processTemplates.renaming.title') }} @cd-action=${this.onDialog}>
      ${renaming
        ? html`<cd-text-field
            class="name"
            .data=${{
              name: 'name',
              label: t('settings.processTemplates.renaming.name'),
              value: renaming.name,
              placeholder: null,
              help: null,
              error: renaming.error,
              state: null,
              multiline: false,
              maxLength: PROCESS_TEMPLATE_NAME_MAX,
            }}
            @keydown=${this.onNameKey}
          ></cd-text-field>`
        : nothing}
      <cd-button
        slot="actions"
        class="cancel"
        .data=${{ label: t('settings.processTemplates.cancel'), variant: 'ghost', size: 'md' }}
        @click=${() => this.emit('cancel', {})}
      ></cd-button>
      <cd-button
        slot="actions"
        class="submit-rename"
        .data=${{ label: t('settings.processTemplates.renaming.submit'), variant: 'primary', size: 'md', icon: 'check' }}
        @click=${this.submitRename}
      ></cd-button>
    </cd-dialog>`;
  }

  private removeDialog(): TemplateResult {
    const { removing } = this.data;
    return html`<cd-dialog
      class="removing"
      .data=${{ open: removing !== null, title: removing ? t('settings.processTemplates.removing.title', { name: removing.name }) : '' }}
      @cd-action=${this.onDialog}
    >
      <p class="text">${t('settings.processTemplates.removing.text')}</p>
      <cd-button
        slot="actions"
        class="cancel"
        .data=${{ label: t('settings.processTemplates.cancel'), variant: 'ghost', size: 'md' }}
        @click=${() => this.emit('cancel', {})}
      ></cd-button>
      <cd-button
        slot="actions"
        class="confirm-remove"
        .data=${{ label: t('settings.processTemplates.removing.submit'), variant: 'danger', size: 'md', icon: 'trash' }}
        @click=${() => {
          if (removing) this.emit('confirmRemove', { id: removing.id });
        }}
      ></cd-button>
    </cd-dialog>`;
  }

  protected override render() {
    const { templates } = this.data;
    return html`<cd-card
        .data=${{ title: t('settings.processTemplates.title'), count: templates.length, label: t('settings.processTemplates.label'), flush: templates.length > 0 }}
        @cd-action=${this.stop}
      >
        ${templates.length === 0 ? this.empty() : templates.map((template) => this.row(template))}
      </cd-card>
      ${this.renameDialog()} ${this.removeDialog()}`;
  }
}
