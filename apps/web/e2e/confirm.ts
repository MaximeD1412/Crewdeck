import { expect, type Page } from '@playwright/test';

/** An Action sensible's confirmation with a three-part consequence: the copy of the mockup `relecture-confirmation`. */
export const APPROVE_PRD = {
  action: 'document.approve',
  title: 'Approuver le PRD de « Agenda partagé » ?',
  confirmLabel: 'Approuver le PRD',
  consequences: {
    lead: 'Crewdeck va :',
    items: [
      { strong: 'merger la PR #14 du PRD', text: ' dans develop ;' },
      { strong: 'démarrer l’Étape Maquettes', text: ' avec le Moteur du Rôle Conception (Claude Code).' },
    ],
    note: 'Tu relis ensuite les maquettes depuis « À toi ».',
  },
} as const;

declare global {
  interface Window {
    __crewdeck?: { confirm(options: typeof APPROVE_PRD): Promise<boolean> };
    __answer?: Promise<boolean>;
  }
}

/** Focuses a button of the page, then opens the dialog from it, as a Composant's action does. */
export const openConfirm = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => window.__crewdeck !== undefined);
  await page.evaluate((options) => {
    const opener = document.createElement('button');
    opener.id = 'opener';
    opener.textContent = 'Approuver';
    document.body.append(opener);
    opener.focus();
    window.__answer = window.__crewdeck?.confirm(options);
  }, APPROVE_PRD);
  await expect(page.getByRole('alertdialog', { name: APPROVE_PRD.title })).toBeVisible();
};

