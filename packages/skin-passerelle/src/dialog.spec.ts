import { COMPOSANTS, t } from '@crewdeck/sdk';
import { userEvent } from 'vitest/browser';
import { actionsOf, deepActiveElement, inside, render, settle, textOf } from './testing/browser.js';

afterEach(() => document.body.replaceChildren());

const body = {
  default: `<cd-text-field data='{"name":"idea","label":"Ton idée","value":"","placeholder":null,"help":null,"error":null,"state":null,"multiline":true,"maxLength":null}'></cd-text-field>`,
  actions: `<cd-button data='{"label":"Noter","variant":"primary","size":"md"}'></cd-button>`,
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
      ['actions', ['cd-button']],
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
