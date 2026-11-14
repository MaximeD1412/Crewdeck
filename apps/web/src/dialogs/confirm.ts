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

export interface ConfirmOptions {
  readonly action: SensitiveActionId;
  readonly title: string;
  readonly confirmLabel: string;
  /** The action button's icon; `check` by default. */
  readonly icon?: IconName;
  /** `danger` for an action that destroys or stops; primary otherwise. */
  readonly tone?: 'primary' | 'danger';
  readonly consequences: ConfirmConsequences;
}

/**
 * `crewdeck-confirm`: the core's confirmation of an Action sensible. A
 * native modal `<dialog role="alertdialog">` marked « Confirmé par Crewdeck »,
 * styled by the `--cd-*` tokens only and exposing no `part`, so a Skin can
 * neither replace nor restyle what the Pilote agrees to. Opened through
 * {@link confirmSensitiveAction}, never placed by a Composant.
 */
export class CrewdeckConfirm extends LitElement {
  static override properties = { options: { attribute: false } };

  static override styles = coreDialogStyles;

  declare options: ConfirmOptions;

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
        <div class="mark">${icon('shield')}<span>${t('confirm.mark')}</span></div>
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

/**
 * Asks the Pilote to confirm an Action sensible in the core's dialog. Resolves
 * true once they confirm, false on « Annuler » or Escape, and false at once
 * while another confirmation is open.
 */
export const confirmSensitiveAction = (options: ConfirmOptions): Promise<boolean> => {
  zSensitiveActionId.parse(options.action);
  if (current?.isConnected) return Promise.resolve(false);
  const dialog = new CrewdeckConfirm();
  dialog.options = options;
  document.body.append(dialog);
  current = dialog;
  return dialog.open();
};
