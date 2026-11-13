import { type SensitiveActionId, zSensitiveActionId } from '@crewdeck/contracts';
import { type IconName, t } from '@crewdeck/sdk';
import { ICONS } from '@crewdeck/skin-passerelle/icons';
import { css, html, LitElement, nothing } from 'lit';

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

/** The focused element, through the shadow roots: the one to give the focus back to. */
const activeElement = (): HTMLElement | null => {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active instanceof HTMLElement ? active : null;
};

const icon = (name: IconName) =>
  html`<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    ${ICONS[name]}
  </svg>`;

/**
 * `crewdeck-confirm`: the core's confirmation of an Action sensible. A
 * native modal `<dialog role="alertdialog">` marked « Confirmé par Crewdeck »,
 * styled by the `--cd-*` tokens only and exposing no `part`, so a Skin can
 * neither replace nor restyle what the Pilote agrees to. Opened through
 * {@link confirmSensitiveAction}, never placed by a Composant.
 */
export class CrewdeckConfirm extends LitElement {
  static override properties = { options: { attribute: false } };

  static override styles = css`
    :host {
      display: contents;
    }
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }
    dialog {
      /* No padding: a click whose target is the dialog itself is on its scrim. */
      padding: 0;
      margin: 0;
      width: 100%;
      max-width: none;
      height: 100%;
      max-height: none;
      border: 0;
      border-top: var(--cd-rail) solid var(--cd-accent);
      background: var(--cd-raised);
      color: var(--cd-ink-2);
      font: var(--cd-font-body-weight) var(--cd-font-body-size) / var(--cd-font-body-line-height)
        var(--cd-font-body-family), sans-serif;
    }
    dialog::backdrop {
      background: var(--cd-scrim);
    }
    .box {
      display: flex;
      flex-direction: column;
      min-height: 100%;
      max-height: 100%;
    }
    .mark {
      display: flex;
      align-items: center;
      gap: var(--cd-space-2);
      padding: var(--cd-space-3) var(--cd-space-4) 0;
      font: var(--cd-font-section-label-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
        var(--cd-font-section-label-family), sans-serif;
      letter-spacing: var(--cd-font-section-label-letter-spacing);
      text-transform: uppercase;
      color: var(--cd-accent-text);
    }
    svg {
      flex: none;
      width: var(--cd-icon-sm);
      height: var(--cd-icon-sm);
    }
    h2 {
      margin: 0;
      padding: var(--cd-space-4) var(--cd-space-4) var(--cd-space-2);
      font: var(--cd-font-page-title-weight) var(--cd-font-brand-size) / var(--cd-font-brand-line-height)
        var(--cd-font-page-title-family), sans-serif;
      color: var(--cd-ink);
    }
    .body {
      flex: 1;
      overflow: auto;
      padding: var(--cd-space-2) var(--cd-space-4) var(--cd-space-4);
      display: flex;
      flex-direction: column;
      gap: var(--cd-space-3);
      font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
        var(--cd-font-body-sm-family), sans-serif;
    }
    p,
    ul {
      margin: 0;
    }
    ul {
      padding-left: var(--cd-space-5);
      display: flex;
      flex-direction: column;
      gap: var(--cd-space-2);
    }
    b {
      color: var(--cd-ink);
    }
    .actions {
      display: flex;
      flex-direction: column-reverse;
      gap: var(--cd-space-2);
      padding: var(--cd-space-3) var(--cd-space-4) var(--cd-space-4);
      border-top: thin solid var(--cd-line);
    }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--cd-space-2);
      width: 100%;
      height: var(--cd-touch);
      margin: 0;
      padding: 0 var(--cd-space-4);
      border-radius: var(--cd-radius);
      border: thin solid transparent;
      background: none;
      white-space: nowrap;
      cursor: pointer;
      font: var(--cd-font-label-weight) var(--cd-font-label-size) / var(--cd-font-label-line-height)
        var(--cd-font-label-family), sans-serif;
    }
    button:focus-visible {
      outline: var(--cd-stroke) solid var(--cd-accent);
      outline-offset: var(--cd-stroke);
    }
    .ghost {
      color: var(--cd-ink-2);
    }
    .ghost:hover {
      background: var(--cd-sunk);
      color: var(--cd-ink);
    }
    .primary {
      background: var(--cd-accent);
      color: var(--cd-accent-ink);
    }
    .primary:hover {
      background: var(--cd-accent-hover);
    }
    .primary:active {
      background: var(--cd-accent-pressed);
    }
    .danger {
      color: var(--cd-halt);
      border-color: var(--cd-halt-soft);
      background: var(--cd-halt-soft);
    }
    .danger:hover {
      border-color: var(--cd-halt);
    }
    @media (min-width: 1280px) {
      dialog {
        margin: auto;
        width: var(--cd-dialog-width);
        /* Not auto: a modal dialog is fixed with inset 0, auto would stretch it to the screen. */
        height: fit-content;
        max-height: 90vh;
        border: thin solid var(--cd-line-strong);
        border-top: var(--cd-rail) solid var(--cd-accent);
        border-radius: var(--cd-radius-lg);
      }
      .box {
        max-height: 90vh;
      }
      .actions {
        flex-direction: row;
        justify-content: flex-end;
      }
      button {
        width: auto;
      }
    }
  `;

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
