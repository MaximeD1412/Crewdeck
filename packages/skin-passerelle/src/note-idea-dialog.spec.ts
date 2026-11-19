/// <reference types="vite/client" />
import './tokens.css';
import './document.css';
import { COMPOSANTS, NoteIdeaDialog, t, type ComposantData } from '@crewdeck/sdk';
import { userEvent } from 'vitest/browser';
import { actionsOf, defineSkin, inside, render, settle, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

type Data = ComposantData<typeof NoteIdeaDialog>;
const [open, chosen, locked] = COMPOSANTS.NoteIdeaDialog.examples.map((example) => example.data as Data);
if (!open || !chosen || !locked) throw new Error('NoteIdeaDialog lacks its examples');

const textarea = (el: Element) => inside<HTMLTextAreaElement>(el, 'cd-text-field.text', 'textarea');
const select = (el: Element) => inside<HTMLSelectElement>(el, 'cd-select.project', 'select');
const type = (el: Element, text: string) => {
  const field = textarea(el);
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
};

describe('NoteIdeaDialog', () => {
  it('open, is the Dialog « Noter une Idée » with its text, its Projet and its note', async () => {
    const el = await render(NoteIdeaDialog, open);
    expect(inside<HTMLDialogElement>(el, 'cd-dialog', 'dialog').open).toBe(true);
    expect(textOf(inside(el, 'cd-dialog', 'h2'))).toBe('Noter une Idée');
    expect(textOf(inside(el, 'cd-text-field.text', 'label'))).toBe(t('idees.dialog.text'));
    expect([...select(el).options].map((option) => option.textContent?.trim())).toEqual([
      'Laisser l’analyse choisir',
      'Crewdeck',
      'Personal OS',
      'Site mairie',
      'Tennis Manager',
    ]);
    expect(select(el).value).toBe('');
    expect(textOf(inside(el, '.note'))).toBe(t('idees.dialog.note'));
    expect([...(el.shadowRoot?.querySelectorAll('cd-button') ?? [])].map((button) => textOf(inside(button, 'button')))).toEqual(['Annuler', 'Noter']);
  });

  it('chooses its default Projet and shows the core’s refusal under the text', async () => {
    const el = await render(NoteIdeaDialog, chosen);
    expect(select(el).value).toBe(chosen.defaultProjectId);
    expect(textOf(inside(el, 'cd-text-field.text', '.error'))).toBe('Écris ton Idée avant de la noter.');
  });

  it('submits the text as typed and the chosen Projet, null when the analysis chooses', async () => {
    const el = await render(NoteIdeaDialog, open);
    type(el, 'Pouvoir dupliquer une recette');
    expect(await actionsOf(() => inside(el, 'cd-button.submit', 'button').click())).toEqual([
      { composant: 'NoteIdeaDialog', action: 'submit', payload: { text: 'Pouvoir dupliquer une recette', projectId: null } },
    ]);
    const native = select(el);
    native.value = open.projects[1]?.id ?? '';
    native.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    native.dispatchEvent(new Event('change', { bubbles: true }));
    const [action] = await actionsOf(() => inside(el, 'cd-button.submit', 'button').click());
    expect(action?.payload).toEqual({ text: 'Pouvoir dupliquer une recette', projectId: open.projects[1]?.id });
    expect(NoteIdeaDialog.actions.submit.safeParse(action?.payload).success).toBe(true);
  });

  it('submits on Ctrl + Enter in the text', async () => {
    const el = await render(NoteIdeaDialog, open);
    textarea(el).focus();
    await userEvent.keyboard('Une Idée');
    const actions = await actionsOf(() => userEvent.keyboard('{Control>}{Enter}{/Control}'));
    expect(actions).toEqual([{ composant: 'NoteIdeaDialog', action: 'submit', payload: { text: 'Une Idée', projectId: null } }]);
  });

  it('cancels on « Annuler » and on Escape, never while busy', async () => {
    const el = await render(NoteIdeaDialog, open);
    expect(await actionsOf(() => inside(el, 'cd-button.cancel', 'button').click())).toEqual([
      { composant: 'NoteIdeaDialog', action: 'cancel', payload: {} },
    ]);
    textarea(el).focus();
    expect(await actionsOf(() => userEvent.keyboard('{Escape}'))).toEqual([{ composant: 'NoteIdeaDialog', action: 'cancel', payload: {} }]);
    el.data = { ...open, busy: true };
    await settle(el);
    expect(inside(el, 'cd-button.submit').getAttribute('aria-busy') ?? (inside(el, 'cd-button.submit') as HTMLElement & { data: { state?: string } }).data.state).toBeTruthy();
    expect(await actionsOf(() => inside(el, 'cd-button.cancel', 'button').click())).toEqual([]);
    expect(await actionsOf(() => inside(el, 'cd-button.submit', 'button').click())).toEqual([]);
  });

  it('gives new fields at each opening', async () => {
    const el = await render(NoteIdeaDialog, open);
    type(el, 'Une Idée');
    el.data = { ...open, open: false };
    await settle(el);
    expect(el.shadowRoot?.querySelector('cd-text-field.text')).toBeNull();
    el.data = open;
    await settle(el);
    expect(textarea(el).value).toBe('');
  });

  it('locked, says why with a link to « Paramètres », and has no field nor « Noter »', async () => {
    const el = await render(NoteIdeaDialog, locked);
    expect(textOf(inside(el, '.locked'))).toBe(`${t('idees.dialog.locked')} ${t('idees.dialog.lockedLink')}`);
    expect(inside<HTMLAnchorElement>(el, '.locked a').getAttribute('href')).toBe('/parametres');
    expect(el.shadowRoot?.querySelector('cd-text-field')).toBeNull();
    expect(el.shadowRoot?.querySelector('cd-button.submit')).toBeNull();
  });

  it('locked, closes as its link leads to « Paramètres »: the link emits cancel', async () => {
    const el = await render(NoteIdeaDialog, locked);
    const link = inside<HTMLAnchorElement>(el, '.locked a');
    // The router takes the link's navigation; here it would leave the test's page.
    link.addEventListener('click', (event) => event.preventDefault());
    expect(await actionsOf(() => link.click())).toEqual([{ composant: 'NoteIdeaDialog', action: 'cancel', payload: {} }]);
  });
});
