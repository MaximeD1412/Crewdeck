import { CUSTOM_ROLES_MAX, ROLE_NAME_MAX, RoleSettings, t, type CdActionDetail, type ComposantData } from '@crewdeck/sdk';
import { css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

type Data = ComposantData<typeof RoleSettings>;
type Role = Data['roles'][number];
type Model = Data['models'][number];
type Control = HTMLElement & { value: string };

/** A model's value in a Select: its Moteur and its id, the same whatever the list around it. */
const keyOf = (model: { readonly engine: string; readonly model: string }): string => `${model.engine}:${model.model}`;

/** A Rôle's options: the usable models, its stored choice first when it is no longer one of them. */
const optionsOf = (models: readonly Model[], choice: Model | null): readonly Model[] =>
  choice && !models.some((model) => keyOf(model) === keyOf(choice)) ? [choice, ...models] : models;

/**
 * A Select's data over `models`, its value the key of `chosen`; with nothing
 * chosen, « Choisis un modèle » first, not choosable; disabled, with its
 * reason, without any model.
 */
const selectData = (name: string, label: string, models: readonly Model[], chosen: string | null, error: string | null) =>
  models.length === 0
    ? { name, label, value: '', options: [{ value: '', label: t('settings.roles.noModel'), disabled: true }], help: null, state: 'disabled' as const }
    : {
        name,
        label,
        value: chosen ?? '',
        options: [
          ...(chosen === null ? [{ value: '', label: t('settings.roles.dialog.pick'), disabled: true }] : []),
          ...models.map((model) => ({ value: keyOf(model), label: model.label, disabled: false })),
        ],
        help: null,
        state: null,
        ...(error ? { error } : {}),
      };

/**
 * `cd-role-settings` (`design/screens/crewdeck/parametres.html`, the card
 * « Rôles et modèles »): a Card holding a SettingRow per Rôle, each with its
 * Select (its label read, not shown: the row names it) and, for a Rôle the
 * Pilote added, a ghost « Retirer ». « Ajouter un Rôle » in the Card's
 * actions, as the Planifications' « Ajouter »; disabled with its reason
 * without any usable model or at `CUSTOM_ROLES_MAX`. The Dialog « Nouveau
 * Rôle » opens with `adding.open`: « Nom », « Moteur et modèle », « Annuler »
 * and « Ajouter » (Enter in the name too); its fields are new at each
 * opening. The actions of the Composants it places stay inside.
 *
 * A model is known by its Moteur and its id, never by its place in the list:
 * the list changes as the Runner reports. The model picked in the Dialog
 * stays picked; gone from the list, it asks for another. A row's last pick
 * is the one it shows and compares to until the store has it, or the row its
 * refusal: picking back the stored model while another is on its way sends it.
 */
export class PasserelleRoleSettings extends PasserelleElement<typeof RoleSettings> {
  static override styles = [
    sharedStyles,
    css`
      cd-button.remove {
        align-self: flex-start;
      }
    `,
  ];

  static override properties = { picked: { state: true } };

  protected readonly composant = RoleSettings;

  /** The model picked in the Dialog « Nouveau Rôle »: the first usable one at its opening, then the Pilote's. */
  declare picked: string | null;

  /** Each row's last pick not yet in the store: the model it shows and compares a new pick to. */
  private readonly pending = new Map<string, string>();

  constructor() {
    super();
    this.picked = null;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed);
    if (!changed.has('data')) return;
    const previous = changed.get('data') as Data | undefined;
    const first = this.data.models[0];
    if (this.data.adding.open && !previous?.adding.open) this.picked = first ? keyOf(first) : null;
    for (const [roleId, key] of this.pending) {
      const role = this.data.roles.find((candidate) => candidate.id === roleId);
      const refused = role?.error != null && role.error !== previous?.roles.find((candidate) => candidate.id === roleId)?.error;
      if (!role || refused || (role.choice && keyOf(role.choice) === key)) this.pending.delete(roleId);
    }
  }

  private stop(event: Event) {
    event.stopPropagation();
  }

  private onDialog(event: Event) {
    event.stopPropagation();
    if ((event as CustomEvent<CdActionDetail>).detail.action === 'close') this.cancel();
  }

  private cancel() {
    if (!this.data.adding.busy) this.emit('cancel', {});
  }

  /** What a row shows: its last pick on its way, else its stored choice. */
  private shownOf(role: Role): string | null {
    return this.pending.get(role.id) ?? (role.choice ? keyOf(role.choice) : null);
  }

  private choose(role: Role, options: readonly Model[], event: Event) {
    const key = (event.currentTarget as Control).value;
    const picked = options.find((model) => keyOf(model) === key);
    if (!picked || key === this.shownOf(role)) return;
    this.pending.set(role.id, key);
    this.requestUpdate();
    this.emit('choose', { roleId: role.id, engine: picked.engine, model: picked.model });
  }

  private pick(event: Event) {
    this.picked = (event.currentTarget as Control).value;
  }

  private create() {
    const { models, adding } = this.data;
    const name = this.shadowRoot?.querySelector<Control>('cd-text-field.name')?.value ?? '';
    const picked = models.find((model) => keyOf(model) === this.picked);
    if (adding.busy || !picked) return;
    this.emit('create', { name, engine: picked.engine, model: picked.model });
  }

  private onNameKey(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.create();
  }

  private row(role: Role): TemplateResult {
    const options = optionsOf(this.data.models, role.choice);
    return html`<cd-setting-row data-role=${role.id} .data=${{ label: role.name, help: role.help, origin: null }}>
      <cd-select
        .data=${selectData(`roles.${role.id}`, t('settings.roles.select', { name: role.name }), options, this.shownOf(role), role.error)}
        @change=${(event: Event) => this.choose(role, options, event)}
      ></cd-select>
      ${role.removable
        ? html`<cd-button
            class="remove"
            .data=${{ label: t('settings.roles.remove'), variant: 'ghost', size: 'sm' }}
            @click=${() => this.emit('remove', { roleId: role.id })}
          ></cd-button>`
        : nothing}
    </cd-setting-row>`;
  }

  private addButton(): TemplateResult {
    const { models, roles } = this.data;
    const reason =
      models.length === 0
        ? t('settings.roles.add.noModel')
        : roles.filter((role) => role.removable).length >= CUSTOM_ROLES_MAX
          ? t('settings.roles.add.tooMany')
          : null;
    return html`<cd-button
      slot="actions"
      class="add"
      .data=${{
        label: t('settings.roles.add'),
        variant: 'ghost',
        size: 'sm',
        icon: 'plus',
        ...(reason ? { state: 'disabled' as const, disabledReason: reason } : {}),
      }}
      @click=${() => {
        if (!reason) this.emit('add', {});
      }}
    ></cd-button>`;
  }

  private fields(): TemplateResult {
    const { models, adding } = this.data;
    const available = models.some((model) => keyOf(model) === this.picked);
    const gone = this.picked !== null && !available;
    return html`<cd-text-field
        class="name"
        .data=${{
          name: 'name',
          label: t('settings.roles.dialog.name'),
          value: '',
          placeholder: t('settings.roles.dialog.placeholder'),
          help: null,
          error: adding.nameError,
          state: null,
          multiline: false,
          maxLength: ROLE_NAME_MAX,
        }}
        @keydown=${this.onNameKey}
      ></cd-text-field>
      <cd-select
        class="model"
        .data=${selectData('model', t('settings.roles.dialog.model'), models, available ? this.picked : null, adding.modelError ?? (gone ? t('settings.roles.dialog.modelGone') : null))}
        @change=${this.pick}
      ></cd-select>`;
  }

  protected override render() {
    const { roles, adding } = this.data;
    return html`<cd-card .data=${{ title: t('settings.roles.title'), label: t('settings.roles.label') }} @cd-action=${this.stop}>
        ${roles.map((role) => this.row(role))} ${this.addButton()}
      </cd-card>
      <cd-dialog .data=${{ open: adding.open, title: t('settings.roles.dialog.title') }} @cd-action=${this.onDialog}>
        ${adding.open ? this.fields() : nothing}
        <cd-button slot="actions" class="cancel" .data=${{ label: t('settings.roles.dialog.cancel'), variant: 'ghost', size: 'md' }} @click=${this.cancel}></cd-button>
        <cd-button
          slot="actions"
          class="create"
          .data=${{ label: t('settings.roles.dialog.submit'), variant: 'primary', size: 'md', ...(adding.busy ? { state: 'loading' as const } : {}) }}
          @click=${this.create}
        ></cd-button>
      </cd-dialog>`;
  }
}
