import { confirmSensitiveAction, type ConfirmOptions } from '../dialogs/confirm.js';

/** What the end-to-end specs drive the page with, outside production only. */
export interface TestHarness {
  /** Opens the core's `crewdeck-confirm`, as an Action sensible does. */
  confirm(options: ConfirmOptions): Promise<boolean>;
}

declare global {
  interface Window {
    __crewdeck?: TestHarness;
  }
}

/** Puts the harness on `window.__crewdeck`; `main.ts` calls it only in development. */
export const installHarness = (target: Window = window): void => {
  target.__crewdeck = { confirm: confirmSensitiveAction };
};
