/// <reference types="vite/client" />
import './tokens.css';
import './document.css';
import { COMPOSANTS, t } from '@crewdeck/sdk';
import { page, userEvent } from 'vitest/browser';
import { actionsOf, deepActiveElement, defineSkin, inside, render, settle, textOf } from './testing/dom.js';

beforeAll(defineSkin);

afterEach(async () => {
  document.body.replaceChildren();
  await page.viewport(1280, 800);
});

const example = COMPOSANTS.PageComposants.examples[0];
if (!example) throw new Error('PageComposants has no example');
const library = {
  ...example.data,
  groups: [
    { category: 'cadre', composants: [{ name: 'PageHeader', version: 1 }] },
    {
      category: 'signal',
      composants: [
        { name: 'Banner', version: 1 },
        { name: 'Button', version: 1 },
        { name: 'StatusBadge', version: 1 },
      ],
    },
  ],
} as const;

const rowNames = (el: Element) => [...(el.shadowRoot?.querySelectorAll('nav cd-list-row') ?? [])].map((row) => textOf(inside(row, 'a')));
const groupTitles = (el: Element) =>
  [...(el.shadowRoot?.querySelectorAll('nav cd-card') ?? [])].map((card) => textOf(inside(card, 'h2')));

describe('the library’s search', () => {
  it('is a TextField « Chercher un Composant » over the catalogue', async () => {
    const el = await render(COMPOSANTS.PageComposants, library);
    const search = inside(el, 'cd-text-field');
    expect(textOf(inside(search, 'label'))).toBe(t('composants.page.search'));
  });

  it('keeps the Composants whose name holds what is typed, case and accents ignored, and their groups only', async () => {
    const el = await render(COMPOSANTS.PageComposants, library);
    await userEvent.fill(inside(el, 'cd-text-field', 'input'), 'BÄN');
    await settle(el);
    expect(rowNames(el)).toEqual(['Banner']);
    expect(groupTitles(el)).toEqual([t('composants.category.signal')]);
    await userEvent.fill(inside(el, 'cd-text-field', 'input'), 'statusbadgé');
    await settle(el);
    expect(rowNames(el)).toEqual(['StatusBadge']);
    await userEvent.fill(inside(el, 'cd-text-field', 'input'), '');
    await settle(el);
    expect(rowNames(el)).toEqual(['PageHeader', 'Banner', 'Button', 'StatusBadge']);
  });

  it('says so when no Composant matches', async () => {
    const el = await render(COMPOSANTS.PageComposants, library);
    await userEvent.fill(inside(el, 'cd-text-field', 'input'), 'Calendrier');
    await settle(el);
    expect(rowNames(el)).toEqual([]);
    expect(textOf(inside(el, 'nav .none'))).toBe(t('composants.page.noMatch'));
  });
});

describe('what the core provides, in the catalogue', () => {
  const withConfirm = {
    ...library,
    groups: [
      library.groups[0],
      { ...library.groups[1], provided: [{ name: 'ConfirmDialog', meta: t('composants.confirmDialog.meta') }] },
    ],
  };
  const provided = (el: Element) => [...(el.shadowRoot?.querySelectorAll('nav cd-list-row') ?? [])].filter((row) => !row.shadowRoot?.querySelector('a'));

  it('is a row with its meta after the group’s Composants, no link, not in the Select', async () => {
    const el = await render(COMPOSANTS.PageComposants, withConfirm);
    const rows = provided(el);
    expect(rows).toHaveLength(1);
    const row = rows[0] as Element;
    expect(textOf(inside(row, '.title'))).toBe('ConfirmDialog');
    expect(textOf(inside(row, '.meta'))).toBe(t('composants.confirmDialog.meta'));
    expect(row.previousElementSibling?.localName).toBe('cd-list-row');
    const options = [...inside(el, 'cd-select', 'select').querySelectorAll('option')].map((option) => textOf(option));
    expect(options.some((label) => label?.startsWith('ConfirmDialog'))).toBe(false);
    const details = await actionsOf(async () => (row as HTMLElement).click());
    expect(details).toEqual([]);
  });

  it('follows the search', async () => {
    const el = await render(COMPOSANTS.PageComposants, withConfirm);
    await userEvent.fill(inside(el, 'cd-text-field', 'input'), 'confirm');
    await settle(el);
    expect(provided(el)).toHaveLength(1);
    expect(groupTitles(el)).toEqual([t('composants.category.signal')]);
    await userEvent.fill(inside(el, 'cd-text-field', 'input'), 'banner');
    await settle(el);
    expect(provided(el)).toHaveLength(0);
  });
});

describe('the library’s Select', () => {
  it('lists every Composant as « <Name> · <group> », the open one chosen', async () => {
    const el = await render(COMPOSANTS.PageComposants, library);
    const select = inside(el, 'cd-select');
    expect(textOf(inside(select, 'label'))).toBe(t('composants.page.select'));
    const options = [...inside(select, 'select').querySelectorAll('option')];
    expect(options.map((option) => textOf(option))).toEqual([
      `PageHeader · ${t('composants.category.cadre')}`,
      `Banner · ${t('composants.category.signal')}`,
      `Button · ${t('composants.category.signal')}`,
      `StatusBadge · ${t('composants.category.signal')}`,
    ]);
    expect(inside<HTMLSelectElement>(select, 'select').value).toBe('Banner');
  });

  it('emits select with the Composant chosen', async () => {
    const el = await render(COMPOSANTS.PageComposants, library);
    await page.viewport(390, 844);
    const details = await actionsOf(() => userEvent.selectOptions(inside(el, 'cd-select', 'select'), 'Button'));
    expect(details).toEqual([{ composant: 'PageComposants', action: 'select', payload: { name: 'Button' } }]);
  });

  it('replaces the search and the groups on the phone; at 1280 px they replace it', async () => {
    const el = await render(COMPOSANTS.PageComposants, library);
    const shown = (selector: string) => getComputedStyle(inside(el, selector)).display !== 'none';
    await page.viewport(390, 844);
    expect([shown('cd-select'), shown('cd-text-field'), shown('nav')]).toEqual([true, false, false]);
    await page.viewport(1280, 800);
    expect([shown('cd-select'), shown('cd-text-field'), shown('nav')]).toEqual([false, true, true]);
  });
});

describe('the preview of an open Dialog', () => {
  const dialogPage = {
    ...library,
    selected: {
      ...library.selected,
      name: 'Dialog',
      tag: 'cd-dialog',
      examples: COMPOSANTS.Dialog.examples.map((dialog) => ({ ...dialog })),
    },
  };

  it('shows it closed, with a button that opens it; « Fermer » closes it and gives the focus back', async () => {
    const el = await render(COMPOSANTS.PageComposants, dialogPage);
    const preview = inside(el, '.stage cd-dialog');
    expect(inside<HTMLDialogElement>(preview, 'dialog').open).toBe(false);
    const opener = inside(el, '.stage cd-button', 'button');
    expect(textOf(opener)).toBe(t('composants.page.openExample', { name: 'noter une Idée' }));
    await userEvent.click(opener);
    await settle(el);
    expect(inside<HTMLDialogElement>(preview, 'dialog').open).toBe(true);
    const details = await actionsOf(async () => {
      inside(preview, 'cd-icon-button', 'button').click();
      await settle(el);
    });
    expect(details).toEqual([]);
    expect(inside<HTMLDialogElement>(preview, 'dialog').open).toBe(false);
    expect(deepActiveElement()).toBe(opener);
  });
});

describe('the preview of a form Composant', () => {
  it('shows each example with its own value', async () => {
    const el = await render(COMPOSANTS.PageComposants, {
      ...library,
      selected: { ...library.selected, name: 'Select', tag: 'cd-select', examples: COMPOSANTS.Select.examples.map((select) => ({ ...select })) },
    });
    const values = [...(el.shadowRoot?.querySelectorAll('.stage cd-select') ?? [])].map((select) => inside<HTMLSelectElement>(select, 'select').value);
    expect(values).toEqual(COMPOSANTS.Select.examples.map((select) => select.data.value));
  });
});
