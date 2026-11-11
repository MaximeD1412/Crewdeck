import { COMPOSANTS, t } from '@crewdeck/sdk';
import { page, userEvent } from 'vitest/browser';
import { actionsOf, deepActiveElement, inside, render, settle, textOf } from './testing/browser.js';

afterEach(() => document.body.replaceChildren());

const body = {
  default: `<cd-text-field data='{"name":"idea","label":"Ton idée","value":"","placeholder":null,"help":null,"error":null,"state":null,"multiline":true,"maxLength":null}'></cd-text-field>`,
  actions: `<cd-button data='{"label":"Annuler","variant":"ghost","size":"md"}'></cd-button><cd-button data='{"label":"Noter","variant":"primary","size":"md"}'></cd-button>`,
};

/** A closed dialog and the button that opens it, focused. */
const withOpener = async () => {
  const opener = document.createElement('button');
  opener.textContent = 'Noter une Idée';
  document.body.append(opener);
  const el = await render(COMPOSANTS.Dialog, { open: false, title: 'Noter une Idée' }, body);
  opener.focus();
  return { opener, el, dialog: inside<HTMLDialogElement>(el, 'dialog') };
};

const closeOf = { composant: 'Dialog', action: 'close', payload: {} };

describe('Dialog', () => {
  it('closed, shows nothing', async () => {
    const { dialog } = await withOpener();
    expect(dialog.open).toBe(false);
  });

  it('open, is a modal dialog named by its title, with the focus inside it', async () => {
    const { el, dialog } = await withOpener();
    el.data = { open: true, title: 'Noter une Idée' };
    await settle(el);
    expect(dialog.open).toBe(true);
    expect(dialog.matches(':modal')).toBe(true);
    expect(textOf(inside(el, `#${dialog.getAttribute('aria-labelledby')}`))).toBe('Noter une Idée');
    const active = deepActiveElement();
    expect(active !== null && (el.contains(active) || isInsideShadow(el, active))).toBe(true);
  });

  it('emits close on Escape, on « Fermer » and on a click on the scrim, and stays open until told', async () => {
    const { el, dialog } = await withOpener();
    el.data = { open: true, title: 'Noter une Idée' };
    await settle(el);
    expect(await actionsOf(() => userEvent.keyboard('{Escape}'))).toEqual([closeOf]);
    expect(dialog.open).toBe(true);
    const close = inside(el, 'cd-icon-button', 'button');
    expect(close.getAttribute('aria-label')).toBe(t('dialog.close'));
    expect(await actionsOf(() => close.click())).toEqual([closeOf]);
    // A click on the scrim lands on the dialog itself; one on its content does not.
    expect(await actionsOf(() => dialog.click())).toEqual([closeOf]);
    expect(await actionsOf(() => inside(el, 'h2').click())).toEqual([]);
    expect(dialog.open).toBe(true);
  });

  it('gives the focus back to its opener once closed', async () => {
    const { opener, el, dialog } = await withOpener();
    el.data = { open: true, title: 'Noter une Idée' };
    await settle(el);
    expect(document.activeElement).not.toBe(opener);
    el.data = { open: false, title: 'Noter une Idée' };
    await settle(el);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('puts its body and its buttons in their Emplacements', async () => {
    const { el } = await withOpener();
    const names = [...(el.shadowRoot?.querySelectorAll('slot') ?? [])].map((slot) => [slot.name, slot.assignedElements().map((node) => node.localName)]);
    expect(names).toEqual([
      ['', ['cd-text-field']],
      ['actions', ['cd-button', 'cd-button']],
    ]);
  });
});

function isInsideShadow(host: Element, node: Element): boolean {
  for (let current: Node | null = node; current; current = (current.getRootNode() as ShadowRoot).host ?? null) {
    if (current === host) return true;
    if (!(current.getRootNode() instanceof ShadowRoot)) return false;
  }
  return false;
}

describe('the Dialog’s layout', () => {
  const opened = async () => {
    const { el, dialog } = await withOpener();
    el.data = { open: true, title: 'Noter une Idée' };
    await settle(el);
    return { el, dialog };
  };
  const box = (node: Element) => node.getBoundingClientRect();
  /** The native buttons of the actions' Emplacement, in the cd-buttons' shadow roots. */
  const buttons = (el: HTMLElement) =>
    [...el.querySelectorAll('cd-button')].map((host) => inside<HTMLButtonElement>(host as HTMLElement, 'button'));
  /** « Annuler » and « Noter », the actions' order. */
  const pair = (el: HTMLElement) => {
    const [annuler, noter] = buttons(el).map(box);
    if (!annuler || !noter) throw new Error('two buttons expected');
    return { annuler, noter };
  };

  afterEach(() => page.viewport(1280, 800));

  it('on the phone, fills the screen, its buttons as wide as it, the last one on top', async () => {
    await page.viewport(390, 844);
    const { el, dialog } = await opened();
    expect([box(dialog).width, box(dialog).height]).toEqual([390, 844]);
    const actions = box(inside(el, '.actions'));
    for (const button of buttons(el)) expect(box(button).width).toBeGreaterThan(actions.width / 2);
    const { annuler, noter } = pair(el);
    expect(noter.top).toBeLessThan(annuler.top);
  });

  it('at 1280 px, is as tall as its content, centred, its buttons side by side on the right, the last one last', async () => {
    const { el, dialog } = await opened();
    const frame = box(dialog);
    expect(frame.height).toBeLessThan(800 / 2);
    expect(Math.round(frame.top + frame.height / 2)).toBe(400);
    const { annuler, noter } = pair(el);
    expect(noter.top).toBe(annuler.top);
    expect(annuler.right).toBeLessThan(noter.left);
    expect(Math.round(noter.right)).toBeGreaterThan(frame.right - 2 * 24);
  });

  it('keeps « Fermer » inside its padding, beside the title', async () => {
    const { el, dialog } = await opened();
    const close = box(inside(inside(el, 'cd-icon-button'), 'button'));
    const frame = box(dialog);
    expect(frame.right - close.right).toBeGreaterThanOrEqual(12);
    expect(close.top - frame.top).toBeGreaterThanOrEqual(12);
  });
});
