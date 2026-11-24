import { type SensitiveActionId, zSensitiveActionId } from '@crewdeck/contracts';
import { type IconName, t } from '@crewdeck/sdk';
import { css, html, LitElement, nothing } from 'lit';
import { activeElement, coreDialogStyles, icon } from './core.js';

/** The core's tag: not a `cd-*` one, so no Skin's Composant can claim it. */
export const CONFIRM_TAG = 'crewdeck-confirm';

/** The fields a form asks, by the `--cd-*` tokens only, as the approval's code field. */
const formStyles = css`
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--cd-space-3);
    padding: 0 var(--cd-space-4) var(--cd-space-4);
    font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height) var(--cd-font-body-sm-family), sans-serif;
  }
  .field,
  .empty {
    display: flex;
    flex-direction: column;
    gap: var(--cd-space-1);
  }
  label,
  .empty-title {
    color: var(--cd-ink);
    font: var(--cd-font-label-weight) var(--cd-font-label-size) / var(--cd-font-label-line-height) var(--cd-font-label-family), sans-serif;
  }
  select,
  input {
    width: 100%;
    min-height: var(--cd-touch);
    margin: 0;
    padding: 0 var(--cd-space-3);
    border: thin solid var(--cd-line-strong);
    border-radius: var(--cd-radius);
    background: var(--cd-sunk);
    color: var(--cd-ink);
    font: inherit;
  }
  input {
    font: var(--cd-font-mono-weight) var(--cd-font-mono-size) / var(--cd-font-mono-line-height) var(--cd-font-mono-family), monospace;
  }
  select:focus-visible,
  input:focus-visible,
  a:focus-visible {
    outline: var(--cd-stroke) solid var(--cd-accent);
    outline-offset: var(--cd-stroke);
  }
  input[aria-invalid='true'] {
    border-color: var(--cd-halt);
  }
  .empty {
    padding: var(--cd-space-3);
    border-radius: var(--cd-radius);
    background: var(--cd-sunk);
  }
  .help {
    color: var(--cd-ink-2);
  }
  .error {
    color: var(--cd-halt);
  }
  a {
    align-self: flex-start;
    color: var(--cd-accent-text);
  }
  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

/** What a sensitive action commits to, as data: rendered as text, never as HTML. */
export interface ConfirmConsequences {
  readonly lead?: string;
  readonly items?: readonly { readonly strong: string; readonly text: string }[];
  readonly note?: string;
}

/** A link of a field: `external` opens it beside the page, which stays on the dialog. */
export interface ConfirmLink {
  readonly href: string;
  readonly label: string;
  readonly external?: boolean;
}

/** A field the dialog asks before its action, as data: rendered as text, never as HTML. */
export type ConfirmField =
  | {
      readonly kind: 'select';
      readonly name: string;
      readonly label: string;
      readonly value: string;
      /** The first option, chosen while no other is. */
      readonly placeholder: string;
      readonly options: readonly { readonly value: string; readonly label: string }[];
      readonly help?: string;
      readonly link?: ConfirmLink;
    }
  | {
      readonly kind: 'text';
      readonly name: string;
      readonly label: string;
      readonly value: string;
      readonly placeholder?: string;
      /** Under the field: where the value stands. */
      readonly message?: string;
      readonly invalid?: boolean;
      readonly disabled?: boolean;
    }
  | { readonly kind: 'empty'; readonly title: string; readonly text?: string; readonly link?: ConfirmLink };

/** What a form shows now: its fields, whether the action can be confirmed, and the consequences as its values make them. */
export interface ConfirmFormView {
  readonly fields: readonly ConfirmField[];
  readonly ready: boolean;
  /** Replaces the options' consequences while given. */
  readonly consequences?: ConfirmConsequences;
}

/**
 * What the action needs picked before it can be confirmed (SOURCE-9: a
 * migration's new place): the dialog draws its view, passes each change on,
 * draws again when it says so, and keeps its action disabled until `ready`.
 */
export interface ConfirmForm {
  view(): ConfirmFormView;
  change(name: string, value: string): void;
  subscribe(fn: () => void): () => void;
}

/** What the core's dialog asks, whatever it confirms. */
export interface ConfirmDialogOptions {
  readonly title: string;
  readonly confirmLabel: string;
  /** The action button's icon; `check` by default. */
  readonly icon?: IconName;
  /** `danger` for an action that destroys or stops; primary otherwise. */
  readonly tone?: 'primary' | 'danger';
  readonly consequences: ConfirmConsequences;
  /** What the Pilote picks before confirming, when the action needs it. */
  readonly form?: ConfirmForm;
}

/** An Action sensible's confirmation (US-26). */
export interface ConfirmOptions extends ConfirmDialogOptions {
  readonly action: SensitiveActionId;
}

/**
 * `crewdeck-confirm`: the core's confirmation of an Action sensible, or of
 * one of the product's own actions (E2E-4: « Retirer » an Appareil). A
 * native modal `<dialog role="alertdialog">` marked « Confirmé par Crewdeck »,
 * styled by the `--cd-*` tokens only and exposing no `part`, so a Skin can
 * neither replace nor restyle what the Pilote agrees to. Opened through
 * {@link confirmSensitiveAction} or {@link confirmProductAction}, never placed
 * by a Composant.
 */
export class CrewdeckConfirm extends LitElement {
  static override properties = { options: { attribute: false } };

  static override styles = [coreDialogStyles, formStyles];

  /** With `action`, an Action sensible's, which the mark says. */
  declare options: ConfirmDialogOptions & { readonly action?: SensitiveActionId };

  /** The Pilote's answer, once: true for the action's button, false otherwise. */
  answer: Promise<boolean>;
  private resolve!: (confirmed: boolean) => void;
  private opener: HTMLElement | null = null;
  private stopForm: (() => void) | null = null;

  constructor() {
    super();
    this.answer = new Promise((resolve) => (this.resolve = resolve));
  }

  private get dialog(): HTMLDialogElement {
    const dialog = this.shadowRoot?.querySelector('dialog');
    if (!dialog) throw new Error('crewdeck-confirm is not rendered');
    return dialog;
  }

  /** Opens the dialog modal, the focus on « Annuler ». */
  async open(): Promise<boolean> {
    this.opener = activeElement();
    await this.updateComplete;
    this.dialog.showModal();
    this.shadowRoot?.querySelector<HTMLButtonElement>('button.ghost')?.focus();
    return this.answer;
  }

  override connectedCallback() {
    super.connectedCallback();
    this.stopForm = this.options.form?.subscribe(() => this.requestUpdate()) ?? null;
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.stopForm?.();
    this.stopForm = null;
  }

  private settle(confirmed: boolean) {
    if (!this.isConnected) return;
    if (confirmed && this.options.form && !this.options.form.view().ready) return;
    this.dialog.close();
    this.remove();
    this.opener?.focus();
    this.opener = null;
    this.resolve(confirmed);
  }

  /** Escape: the same as « Annuler ». */
  private onCancel(event: Event) {
    event.preventDefault();
    this.settle(false);
  }

  private link(link: ConfirmLink | undefined) {
    if (!link) return nothing;
    return link.external
      ? html`<a href=${link.href} target="_blank" rel="noopener">${link.label}</a>`
      : html`<a href=${link.href}>${link.label}</a>`;
  }

  private field(field: ConfirmField, form: ConfirmForm) {
    const id = `field-${field.kind}-${field.kind === 'empty' ? '' : field.name}`;
    switch (field.kind) {
      case 'select':
        return html`<div class="field">
          <label for=${id}>${field.label}</label>
          <select id=${id} aria-describedby=${field.help === undefined ? nothing : `${id}-help`} @change=${(event: Event) => form.change(field.name, (event.target as HTMLSelectElement).value)}>
            <option value="" ?selected=${field.value === ''}>${field.placeholder}</option>
            ${field.options.map((option) => html`<option value=${option.value} ?selected=${option.value === field.value}>${option.label}</option>`)}
          </select>
          ${field.help === undefined ? nothing : html`<p id=${`${id}-help`} class="help">${field.help}</p>`}
          ${this.link(field.link)}
        </div>`;
      case 'text':
        return html`<div class="field">
          <label for=${id}>${field.label}</label>
          <input
            id=${id}
            autocomplete="off"
            spellcheck="false"
            placeholder=${field.placeholder ?? nothing}
            .value=${field.value}
            ?disabled=${field.disabled ?? false}
            aria-invalid=${field.invalid ? 'true' : 'false'}
            aria-describedby=${field.message === undefined ? nothing : `${id}-message`}
            @input=${(event: Event) => form.change(field.name, (event.target as HTMLInputElement).value)}
          />
          ${field.message === undefined ? nothing : html`<p id=${`${id}-message`} class=${field.invalid ? 'help error' : 'help'} aria-live="polite">${field.message}</p>`}
        </div>`;
      case 'empty':
        return html`<div class="empty">
          <p class="empty-title">${field.title}</p>
          ${field.text === undefined ? nothing : html`<p>${field.text}</p>`} ${this.link(field.link)}
        </div>`;
    }
  }

  protected override render() {
    const { title, confirmLabel, tone = 'primary', form } = this.options;
    const asked = form?.view();
    const consequences = asked?.consequences ?? this.options.consequences;
    return html`<dialog
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="title"
      aria-describedby="consequences"
      @cancel=${this.onCancel}
    >
      <div class="box">
        <div class="mark">${icon('shield')}<span>${t(this.options.action === undefined ? 'confirm.mark.product' : 'confirm.mark')}</span></div>
        <h2 id="title">${title}</h2>
        <div class="body" id="consequences">
          ${consequences.lead === undefined ? nothing : html`<p>${consequences.lead}</p>`}
          ${consequences.items?.length
            ? html`<ul>
                ${consequences.items.map((item) => html`<li><b>${item.strong}</b>${item.text}</li>`)}
              </ul>`
            : nothing}
          ${consequences.note === undefined ? nothing : html`<p>${consequences.note}</p>`}
        </div>
        ${form && asked ? html`<div class="fields">${asked.fields.map((field) => this.field(field, form))}</div>` : nothing}
        <div class="actions">
          <button type="button" class="ghost" @click=${() => this.settle(false)}>${t('confirm.cancel')}</button>
          <button type="button" class=${tone} ?disabled=${asked ? !asked.ready : false} @click=${() => this.settle(true)}>
            ${icon(this.options.icon ?? 'check')}<span>${confirmLabel}</span>
          </button>
        </div>
      </div>
    </dialog>`;
  }
}

// Defined when the core's modules evaluate, before any Skin's: a Skin that
// tries to take the tag throws at its own define.
if (customElements.get(CONFIRM_TAG) !== undefined) {
  throw new Error(`${CONFIRM_TAG} est déjà défini : il est réservé au cœur de Crewdeck.`);
}
customElements.define(CONFIRM_TAG, CrewdeckConfirm);

let current: CrewdeckConfirm | null = null;

/** Opens the core's dialog, false at once while another one is open. */
const openConfirm = (options: CrewdeckConfirm['options']): Promise<boolean> => {
  if (current?.isConnected) return Promise.resolve(false);
  const dialog = new CrewdeckConfirm();
  dialog.options = options;
  document.body.append(dialog);
  current = dialog;
  return dialog.open();
};

/**
 * Asks the Pilote to confirm an Action sensible in the core's dialog. Resolves
 * true once they confirm, false on « Annuler » or Escape, and false at once
 * while another confirmation is open.
 */
export const confirmSensitiveAction = (options: ConfirmOptions): Promise<boolean> => {
  zSensitiveActionId.parse(options.action);
  return openConfirm(options);
};

/**
 * The same dialog for one of the product's own actions, which no Skin asks
 * (« Retirer » an Appareil): marked « Confirmé par Crewdeck », not an Action
 * sensible, and with no `seq` of its own.
 */
export const confirmProductAction = (options: ConfirmDialogOptions): Promise<boolean> => openConfirm(options);
