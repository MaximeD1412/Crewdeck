import { FOLDER_PATH_MAX, FolderProjectForm, PROJECT_NAME_MAX, t, type ComposantData } from '@crewdeck/sdk';
import { css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

type Data = ComposantData<typeof FolderProjectForm>;
type Check = Data['check'];

/** The check's states that let the Projet be created: a git repository's root, or a folder `git init` will prepare. */
const CREATABLE: ReadonlySet<Check['state']> = new Set(['ready', 'not-git']);

/** The check's states said as the path's error, the others as its help. */
const ERRORS: ReadonlySet<Check['state']> = new Set(['not-absolute', 'missing', 'not-a-folder', 'taken', 'runner-offline', 'timeout']);

/** The check's line: « Dossier introuvable sur atelier-pc. », « Dépôt git · vide. »… */
const checkLine = ({ state, hasCode }: Check, machine: string | null): string => {
  const where = { machine: machine ?? t('projets.local.thisMachine') };
  if (state === 'ready') return t(hasCode ? 'projets.local.check.ready.hasCode' : 'projets.local.check.ready.empty');
  return t(`projets.local.check.${state}`, where);
};

/**
 * `cd-folder-project-form` (`design/screens/crewdeck/demarrage-projets.html`,
 * the folder's tab): a TextField « Chemin du dossier » whose help, or error,
 * is the check's line, each keystroke emitting `checkPath` (the page
 * debounces); a TextField « Nom du Projet » showing `data.name` until the
 * Pilote types one, then keeping theirs; the Select « Modèle de process »;
 * « Créer le Projet » (`create`), disabled until the check is `ready` or
 * `not-git` with a name, loading while `busy`, saying why beside it while
 * `vaultLocked`; « Plus tard » (`later`) in « Premiers pas ». `repick`: the
 * path only and « Relier ce dossier », with the Projet's own name.
 */
export class PasserelleFolderProjectForm extends PasserelleElement<typeof FolderProjectForm> {
  static override properties = { path: { state: true }, typedName: { state: true }, template: { state: true } };
  static override styles = [
    sharedStyles,
    css`
      :host,
      section {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-5);
      }
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-4);
      }
      .actions {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
        --passerelle-button-width: 100%;
      }
    `,
  ];

  protected readonly composant = FolderProjectForm;
  /** The path as typed: `data.path`, then each keystroke, until `data.path` changes. */
  declare path: string;
  /** The name the Pilote typed, or `null` while « Nom du Projet » follows `data.name`. */
  declare typedName: string | null;
  /** The Modèle chosen: `data.templateId`, then the Pilote's choice, until `data.templateId` changes. */
  declare template: string;

  constructor() {
    super();
    this.path = '';
    this.typedName = null;
    this.template = '';
  }

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (!changed.has('data')) return;
    const previous = changed.get('data') as Data | undefined;
    if (previous?.path !== this.data.path) this.path = this.data.path;
    if (previous?.templateId !== this.data.templateId) this.template = this.data.templateId;
  }

  /** The name the Projet gets: the Pilote's, else the folder's; the Projet's own when choosing its folder again. */
  private get name(): string {
    return this.data.context === 'repick' ? this.data.name : (this.typedName ?? this.data.name);
  }

  private get templateId(): string {
    return this.template || this.data.templateId || (this.data.templates[0]?.id ?? '');
  }

  private get creatable(): boolean {
    const { check, vaultLocked, busy } = this.data;
    return CREATABLE.has(check.state) && this.path.trim() !== '' && this.name.trim() !== '' && this.templateId !== '' && !vaultLocked && !busy;
  }

  private onPath(event: Event) {
    this.path = (event.currentTarget as HTMLElement & { value: string }).value;
    this.emit('checkPath', { path: this.path });
  }

  private onName(event: Event) {
    this.typedName = (event.currentTarget as HTMLElement & { value: string }).value;
  }

  private onTemplate(event: Event) {
    this.template = (event.currentTarget as HTMLElement & { value: string }).value;
  }

  private create() {
    if (!this.creatable) return;
    this.emit('create', { path: this.path, name: this.name.trim(), templateId: this.templateId });
  }

  private pathField(): TemplateResult {
    const { check, machine } = this.data;
    const line = checkLine(check, machine);
    const failed = ERRORS.has(check.state);
    return html`<cd-text-field
      class="path"
      .data=${{
        name: 'path',
        label: t('projets.local.path'),
        value: this.data.path,
        placeholder: t('projets.local.path.placeholder'),
        help: failed ? null : line,
        error: failed ? line : null,
        state: null,
        multiline: false,
        maxLength: FOLDER_PATH_MAX,
      }}
      @input=${this.onPath}
    ></cd-text-field>`;
  }

  private nameField(): TemplateResult {
    return html`<cd-text-field
      class="name"
      .data=${{
        name: 'name',
        label: t('projets.local.name'),
        value: this.typedName ?? this.data.name,
        placeholder: null,
        help: null,
        error: null,
        state: null,
        multiline: false,
        maxLength: PROJECT_NAME_MAX,
      }}
      @input=${this.onName}
    ></cd-text-field>`;
  }

  private templateField(): TemplateResult {
    return html`<cd-select
      class="template"
      .data=${{
        name: 'templateId',
        label: t('projets.template'),
        value: this.templateId,
        options: this.data.templates.map((template) => ({ value: template.id, label: template.label, disabled: false })),
        help: null,
        state: null,
      }}
      @input=${this.onTemplate}
    ></cd-select>`;
  }

  private actions(): TemplateResult {
    const { context, busy, vaultLocked } = this.data;
    const state = busy
      ? { state: 'loading' as const }
      : vaultLocked
        ? { state: 'disabled' as const, disabledReason: t('projets.local.vaultLocked') }
        : this.creatable
          ? {}
          : { state: 'disabled' as const };
    const label = t(context === 'repick' ? 'projets.local.relink' : 'projets.local.create');
    return html`<div class="actions">
      <cd-button class="create" .data=${{ label, variant: 'primary', size: 'md', ...state }} @click=${this.create}></cd-button>
      ${context === 'demarrage'
        ? html`<cd-button
            class="later"
            .data=${{ label: t('projets.local.later'), variant: 'ghost', size: 'md', ...(busy ? { state: 'disabled' as const } : {}) }}
            @click=${() => {
              if (!this.data.busy) this.emit('later', {});
            }}
          ></cd-button>`
        : nothing}
    </div>`;
  }

  protected override render() {
    const repick = this.data.context === 'repick';
    return html`<section aria-label=${t('projets.local.label')}>
      <div class="fields">${this.pathField()} ${repick ? nothing : html`${this.nameField()} ${this.templateField()}`}</div>
      ${this.actions()}
    </section>`;
  }
}
