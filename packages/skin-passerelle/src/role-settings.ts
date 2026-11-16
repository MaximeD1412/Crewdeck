import { CUSTOM_ROLES_MAX, ROLE_NAME_MAX, RoleSettings, t, type CdActionDetail, type ComposantData } from '@crewdeck/sdk';
import { css, html, nothing, type TemplateResult } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

type Data = ComposantData<typeof RoleSettings>;
type Role = Data['roles'][number];
type Model = Data['models'][number];
type Control = HTMLElement & { value: string };

const same = (a: Model, b: Model): boolean => a.engine === b.engine && a.model === b.model;

/** A Rôle's options: the usable models, its stored choice first when it is no longer one of them. */
const optionsOf = (models: readonly Model[], choice: Model | null): readonly Model[] =>
  choice && !models.some((model) => same(model, choice)) ? [choice, ...models] : models;

/** A Select's data over `models`, its value the index of `chosen`; disabled, with its reason, without any. */
const selectData = (name: string, label: string, models: readonly Model[], chosen: Model | null, error: string | null) => {
  const index = chosen ? models.findIndex((model) => same(model, chosen)) : -1;
  return models.length === 0
    ? { name, label, value: '', options: [{ value: '', label: t('settings.roles.noModel'), disabled: true }], help: null, state: 'disabled' as const }
    : {
        name,
        label,
        value: String(Math.max(index, 0)),
        options: models.map((model, i) => ({ value: String(i), label: model.label, disabled: false })),
        help: null,
        state: null,
        ...(error ? { error } : {}),
      };
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
 */
export class PasserelleRoleSettings extends PasserelleElement<typeof RoleSettings> {
  static override styles = [
    sharedStyles,
    css`
      cd-setting-row cd-select::part(label) {
        position: absolute;
        width: var(--cd-stroke);
        height: var(--cd-stroke);
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      cd-button.remove {
        align-self: flex-start;
      }
    `,
  ];

  protected readonly composant = RoleSettings;

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

  private choose(role: Role, options: readonly Model[], event: Event) {
    const picked = options[Number((event.currentTarget as Control).value)];
    if (!picked || (role.choice && same(picked, role.choice))) return;
    this.emit('choose', { roleId: role.id, engine: picked.engine, model: picked.model });
  }

  private create() {
    const { models, adding } = this.data;
    const name = this.shadowRoot?.querySelector<Control>('cd-text-field.name')?.value ?? '';
    const picked = models[Number(this.shadowRoot?.querySelector<Control>('cd-select.model')?.value ?? 0)];
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
        .data=${selectData(`roles.${role.id}`, t('settings.roles.select', { name: role.name }), options, role.choice, role.error)}
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
      <cd-select class="model" .data=${selectData('model', t('settings.roles.dialog.model'), models, null, adding.modelError)}></cd-select>`;
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
