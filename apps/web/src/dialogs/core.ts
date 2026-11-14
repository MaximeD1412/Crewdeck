import type { IconName } from '@crewdeck/sdk';
import { ICONS } from '@crewdeck/skin-passerelle/icons';
import { css, html } from 'lit';

/**
 * What the core's dialogs share (`crewdeck-confirm`, the approval of an
 * Appareil): a native modal `<dialog>` styled by the `--cd-*` tokens only,
 * full screen on the phone and `--cd-dialog-width` from 1280 px, with no
 * `part` a Skin could restyle.
 */

/** The focused element, through the shadow roots: the one to give the focus back to. */
export const activeElement = (): HTMLElement | null => {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active instanceof HTMLElement ? active : null;
};

export const icon = (name: IconName) =>
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

/** The core dialogs' styles: the mark, the title, the body, the actions and their buttons. */
export const coreDialogStyles = css`
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
