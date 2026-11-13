/// <reference types="vite/client" />
import '@crewdeck/skin-passerelle/tokens.css';
import * as sdk from '@crewdeck/sdk';
import { COMPOSANTS, t } from '@crewdeck/sdk';
import { userEvent } from 'vitest/browser';
import { CONFIRM_TAG, confirmSensitiveAction, CrewdeckConfirm, type ConfirmOptions } from './confirm.js';

const options: ConfirmOptions = {
  action: 'loop.start',
  title: 'Démarrer la Boucle de Site mairie ?',
  confirmLabel: 'Démarrer la Boucle',
  icon: 'play',
  consequences: {
    lead: 'En démarrant la Boucle, tu acceptes, jusqu’à ce que tu l’arrêtes :',
    items: [
      { strong: 'du travail en arrière-plan sur tes Comptes IA', text: ', sur ton Runner ;' },
      { strong: 'le merge de chaque Ticket qui passe sa review', text: ' et ses checks.' },
    ],
    note: 'Un Ticket bloqué t’attend dans « À toi ».',
  },
};

/** The deepest focused element, through the shadow roots. */
const focused = (): Element | null => {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
};

const shadow = (): ShadowRoot => {
  const host = document.querySelector(CONFIRM_TAG);
  if (!host?.shadowRoot) throw new Error('no crewdeck-confirm open');
  return host.shadowRoot;
};
const dialog = () => shadow().querySelector('dialog') as HTMLDialogElement;
const buttons = () => [...shadow().querySelectorAll('button')];
const button = (label: string) => {
  const found = buttons().find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`no button ${label}`);
  return found;
};

/** Opens the dialog from a focused button, as a page does. */
const open = async (asked: ConfirmOptions = options) => {
  const opener = document.createElement('button');
  opener.textContent = 'Démarrer';
  document.body.append(opener);
  opener.focus();
  const answer = confirmSensitiveAction(asked);
  await expect.poll(() => document.querySelector(CONFIRM_TAG) !== null && dialog()?.open).toBe(true);
  return { opener, answer };
};

afterEach(() => document.body.replaceChildren());

describe('crewdeck-confirm', () => {
  it('opens a modal alertdialog: the mark, the title, the consequences, « Annuler » then the action, the focus on « Annuler »', async () => {
    await open();
    const el = dialog();
    expect(el.matches(':modal')).toBe(true);
    expect(el.getAttribute('role')).toBe('alertdialog');
    expect(shadow().getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(options.title);
    expect(shadow().textContent).toContain(t('confirm.mark'));
    const body = shadow().getElementById(el.getAttribute('aria-describedby') ?? '');
    expect(body?.querySelector('p')?.textContent).toBe(options.consequences.lead);
    expect([...(body?.querySelectorAll('li') ?? [])].map((li) => [li.querySelector('b')?.textContent, li.textContent])).toEqual([
      ['du travail en arrière-plan sur tes Comptes IA', 'du travail en arrière-plan sur tes Comptes IA, sur ton Runner ;'],
      ['le merge de chaque Ticket qui passe sa review', 'le merge de chaque Ticket qui passe sa review et ses checks.'],
    ]);
    expect(body?.querySelector('p:last-child')?.textContent).toBe(options.consequences.note);
    expect(buttons().map((b) => b.textContent?.trim())).toEqual([t('confirm.cancel'), 'Démarrer la Boucle']);
    expect(focused()).toBe(button(t('confirm.cancel')));
  });

  it('« Annuler » resolves false, closes, and gives the focus back to the opener', async () => {
    const { opener, answer } = await open();
    button(t('confirm.cancel')).click();
    await expect(answer).resolves.toBe(false);
    expect(document.querySelector(CONFIRM_TAG)).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('Escape resolves false and gives the focus back', async () => {
    const { opener, answer } = await open();
    await userEvent.keyboard('{Escape}');
    await expect(answer).resolves.toBe(false);
    expect(document.querySelector(CONFIRM_TAG)).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('the action’s button resolves true, once', async () => {
    const { opener, answer } = await open();
    const confirm = button('Démarrer la Boucle');
    confirm.click();
    confirm.click();
    await expect(answer).resolves.toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  it('draws the action primary, or danger when asked', async () => {
    const color = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const rgb = (value: string) => {
      const probe = document.createElement('span');
      probe.style.color = value;
      document.body.append(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return resolved;
    };
    const first = await open();
    expect(getComputedStyle(button('Démarrer la Boucle')).backgroundColor).toBe(rgb(color('--cd-accent')));
    button(t('confirm.cancel')).click();
    await first.answer;
    await open({ ...options, confirmLabel: 'Supprimer', icon: 'trash', tone: 'danger' });
    expect(getComputedStyle(button('Supprimer')).color).toBe(rgb(color('--cd-halt')));
  });

  it('renders the consequences as text, never as HTML', async () => {
    await open({ ...options, consequences: { items: [{ strong: '<img src=x>', text: '<script>alert(1)</script>' }] } });
    expect(shadow().querySelector('img, script')).toBeNull();
    expect(shadow().querySelector('li')?.textContent).toBe('<img src=x><script>alert(1)</script>');
  });

  it('exposes no part: a Skin cannot restyle it', async () => {
    await open();
    expect(shadow().querySelector('[part], [exportparts]')).toBeNull();
  });

  it('answers false to a second confirmation while one is open', async () => {
    await open();
    await expect(confirmSensitiveAction({ ...options, title: 'Une autre ?' })).resolves.toBe(false);
    expect(document.querySelectorAll(CONFIRM_TAG)).toHaveLength(1);
  });

  it('is the core’s: defined under crewdeck-confirm, not a cd-* tag, absent from the registry and the SDK, never redefined', () => {
    expect(CONFIRM_TAG).toBe('crewdeck-confirm');
    expect(customElements.get(CONFIRM_TAG)).toBe(CrewdeckConfirm);
    expect(() => customElements.define(CONFIRM_TAG, class extends HTMLElement {})).toThrow();
    expect(Object.keys(COMPOSANTS)).not.toContain('ConfirmDialog');
    expect(Object.values(COMPOSANTS).map((d) => d.tag as string)).not.toContain(CONFIRM_TAG);
    expect(Object.keys(sdk).filter((name) => /confirm/i.test(name))).toEqual([]);
  });
});
