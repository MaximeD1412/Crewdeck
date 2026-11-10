import { Dialog, t } from '@crewdeck/sdk';
import { css, html, type PropertyValues } from 'lit';
import { isFilled, PasserelleElement, sharedStyles } from './base.js';

/** The focused element, through the shadow roots: the one to give the focus back to. */
const activeElement = (): HTMLElement | null => {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active instanceof HTMLElement ? active : null;
};

/**
 * `cd-dialog`: a native modal `<dialog>` (the browser keeps the focus in it
 * and the rest of the page inert), named by its title. `data.open` opens and
 * closes it; « Fermer », Escape and a click on the scrim only emit `close`,
 * for the Composant that placed it to set `open` to false. Opened, the focus
 * moves into it; closed, it goes back to the element that had it. Full screen
 * on the phone, `--cd-dialog-width` from 1280 px.
 */
export class PasserelleDialog extends PasserelleElement<typeof Dialog> {
  static override properties = { hasActions: { state: true } };

  static override styles = [
    sharedStyles,
    css`
      dialog {
        /* No padding: a click whose target is the dialog itself is on its scrim. */
        padding: 0;
        margin: 0;
        width: 100%;
        max-width: none;
        height: 100%;
        max-height: none;
        border: 0;
        background: var(--cd-raised);
        color: var(--cd-ink-2);
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
      .head {
        display: flex;
        align-items: center;
        gap: var(--cd-space-3);
        padding: var(--cd-space-2) var(--cd-space-2) var(--cd-space-2) var(--cd-space-4);
      }
      h2 {
        flex: 1;
        margin: 0;
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
      .actions {
        display: flex;
        flex-direction: column-reverse;
        gap: var(--cd-space-2);
        padding: var(--cd-space-3) var(--cd-space-4) var(--cd-space-4);
        border-top: thin solid var(--cd-line);
      }
      .actions[hidden] {
        display: none;
      }
      .actions ::slotted(*) {
        width: 100%;
      }
      @media (min-width: 1280px) {
        dialog {
          margin: auto;
          width: var(--cd-dialog-width);
          height: auto;
          max-height: 90vh;
          border: thin solid var(--cd-line-strong);
          border-radius: var(--cd-radius-lg);
        }
        .box {
          max-height: 90vh;
        }
        .actions {
          flex-direction: row;
          justify-content: flex-end;
        }
        .actions ::slotted(*) {
          width: auto;
        }
      }
    `,
  ];

  protected readonly composant = Dialog;
  declare hasActions: boolean;

  /** Who had the focus when the dialog opened. */
  private opener: HTMLElement | null = null;

  constructor() {
    super();
    this.hasActions = false;
  }

  private get dialog(): HTMLDialogElement | null {
    return this.shadowRoot?.querySelector('dialog') ?? null;
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    const dialog = this.dialog;
    if (!dialog) return;
    if (this.data.open && !dialog.open) {
      this.opener = activeElement();
      dialog.showModal();
    } else if (!this.data.open && dialog.open) {
      this.shut(dialog);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.dialog?.open) this.shut(this.dialog);
  }

  private shut(dialog: HTMLDialogElement) {
    dialog.close();
    this.opener?.focus();
    this.opener = null;
  }

  /** Escape: the dialog stays open, its owner decides. */
  private onCancel(event: Event) {
    if (!event.cancelable) return; // The browser closes it anyway: `onClose` tells.
    event.preventDefault();
    this.emit('close', {});
  }

  /** Closed by the browser, not by `data.open`. */
  private onClose() {
    if (this.data.open) this.emit('close', {});
  }

  private onClick(event: MouseEvent) {
    if (event.target === event.currentTarget) this.emit('close', {});
  }

  protected override render() {
    return html`<dialog
      part="dialog"
      aria-labelledby="title"
      @cancel=${this.onCancel}
      @close=${this.onClose}
      @click=${this.onClick}
    >
      <div class="box">
        <div class="head">
          <h2 id="title" part="title">${this.data.title}</h2>
          <cd-icon-button
            .data=${{ icon: 'x', label: t('dialog.close') }}
            @click=${() => this.emit('close', {})}
          ></cd-icon-button>
        </div>
        <div class="body" part="body"><slot></slot></div>
        <div class="actions" part="actions" ?hidden=${!this.hasActions}>
          <slot name="actions" @slotchange=${(e: Event) => (this.hasActions = isFilled(e.target as HTMLSlotElement))}></slot>
        </div>
      </div>
    </dialog>`;
  }
}
