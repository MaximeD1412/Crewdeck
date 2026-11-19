import { type SensitiveActionId, zSensitiveActionId } from '@crewdeck/contracts';
import { type IconName, t } from '@crewdeck/sdk';
import { html, LitElement, nothing } from 'lit';
import { activeElement, coreDialogStyles, icon } from './core.js';

/** The core's tag: not a `cd-*` one, so no Skin's Composant can claim it. */
export const CONFIRM_TAG = 'crewdeck-confirm';

/** What a sensitive action commits to, as data: rendered as text, never as HTML. */
export interface ConfirmConsequences {
  readonly lead?: string;
  readonly items?: readonly { readonly strong: string; readonly text: string }[];
  readonly note?: string;
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

  static override styles = coreDialogStyles;

  /** With `action`, an Action sensible's, which the mark says. */
  declare options: ConfirmDialogOptions & { readonly action?: SensitiveActionId };

  /** The Pilote's answer, once: true for the action's button, false otherwise. */
  answer: Promise<boolean>;
  private resolve!: (confirmed: boolean) => void;
  private opener: HTMLElement | null = null;

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

  private settle(confirmed: boolean) {
    if (!this.isConnected) return;
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

  protected override render() {
    const { title, confirmLabel, consequences, tone = 'primary' } = this.options;
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
        <div class="actions">
          <button type="button" class="ghost" @click=${() => this.settle(false)}>${t('confirm.cancel')}</button>
          <button type="button" class=${tone} @click=${() => this.settle(true)}>
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
