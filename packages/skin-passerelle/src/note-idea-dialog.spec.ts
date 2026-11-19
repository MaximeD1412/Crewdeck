/// <reference types="vite/client" />
import './tokens.css';
import './document.css';
import { COMPOSANTS, NoteIdeaDialog, t, type ComposantData } from '@crewdeck/sdk';
import { userEvent } from 'vitest/browser';
import { actionsOf, defineSkin, inside, render, settle, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

type Data = ComposantData<typeof NoteIdeaDialog>;
const example = (name: string): Data => {
  const found = COMPOSANTS.NoteIdeaDialog.examples.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`NoteIdeaDialog lacks its example « ${name} »`);
  return found.data as Data;
};
const open = example('ouvert');
const chosen = example('un Projet choisi, refusé');
const locked = example('Appareil à approuver');
const dictating = example('dictée en cours');
const firstTime = example('première dictée de l’Appareil');
const refused = example('micro refusé');
const missing = example('sans dictée');

const textarea = (el: Element) => inside<HTMLTextAreaElement>(el, 'cd-text-field.text', 'textarea');
const select = (el: Element) => inside<HTMLSelectElement>(el, 'cd-select.project', 'select');
const dictate = (el: Element) => el.shadowRoot?.querySelector<HTMLElement & { data: { label: string; icon?: string; variant: string } }>('cd-button.dictate') ?? null;
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
    expect([...(el.shadowRoot?.querySelectorAll('cd-button') ?? [])].map((button) => textOf(inside(button, 'button')))).toEqual(['Dicter', 'Annuler', 'Noter']);
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

  describe('dictated', () => {
    it('offers « Dicter », a secondary button with the mic, which asks to dictate after the text typed', async () => {
      const el = await render(NoteIdeaDialog, open);
      expect(dictate(el)?.data).toMatchObject({ label: 'Dicter', icon: 'mic', variant: 'secondary' });
      expect(el.shadowRoot?.querySelector('.rec')).toBeNull();
      expect(inside(el, 'cd-text-field.text').shadowRoot?.querySelector('.help')).toBeNull();
      type(el, 'Une Idée :');
      expect(await actionsOf(() => inside(dictate(el) as Element, 'button').click())).toEqual([
        { composant: 'NoteIdeaDialog', action: 'dictate-start', payload: { text: 'Une Idée :' } },
      ]);
    });

    it('while dictating, shows « Dictée en cours · 0:07 », the transcript, the help, and « Arrêter la dictée »', async () => {
      const el = await render(NoteIdeaDialog, dictating);
      expect(textOf(inside(el, '.rec'))).toBe('Dictée en cours · 0:07');
      expect(inside(el, '.rec').getAttribute('role')).toBe('status');
      expect(inside(el, '.rec cd-status-dot')).toMatchObject({ data: { tone: 'halt', pulse: true } });
      expect(textarea(el).value).toBe(dictating.value);
      expect(textOf(inside(el, 'cd-text-field.text', '.help'))).toBe('Transcription en direct : tu pourras la corriger avant de noter.');
      expect(dictate(el)?.data).toMatchObject({ label: 'Arrêter la dictée', icon: 'stop', variant: 'secondary' });
      expect(el.shadowRoot?.querySelector('.notice')).toBeNull();
      expect(await actionsOf(() => inside(dictate(el) as Element, 'button').click())).toEqual([
        { composant: 'NoteIdeaDialog', action: 'dictate-stop', payload: {} },
      ]);
    });

    it('the field follows the transcript, then stays editable once stopped, and « Noter » sends what it holds', async () => {
      const el = await render(NoteIdeaDialog, { ...dictating, value: 'Pouvoir' });
      el.data = { ...dictating, value: 'Pouvoir dupliquer' };
      await settle(el);
      expect(textarea(el).value).toBe('Pouvoir dupliquer');
      el.data = { ...open, value: 'Pouvoir dupliquer une recette' };
      await settle(el);
      expect(textarea(el).value).toBe('Pouvoir dupliquer une recette');
      expect(textarea(el).disabled).toBe(false);
      type(el, 'Pouvoir dupliquer une recette en variante');
      const [action] = await actionsOf(() => inside(el, 'cd-button.submit', 'button').click());
      expect(action?.payload).toEqual({ text: 'Pouvoir dupliquer une recette en variante', projectId: null });
    });

    it('the first time on the Appareil, says that the browser’s service hears it, above the help', async () => {
      const el = await render(NoteIdeaDialog, firstTime);
      expect(textOf(inside(el, '.notice'))).toBe(
        'La dictée passe par le service de reconnaissance de ton navigateur (Google pour Chrome, Apple pour Safari).',
      );
    });

    it('says why the last dictation ended, « Micro refusé », and is idle', async () => {
      const el = await render(NoteIdeaDialog, refused);
      expect(textOf(inside(el, '.dictation-error'))).toBe('Micro refusé : autorise-le dans ton navigateur.');
      expect(inside(el, '.dictation-error').getAttribute('role')).toBe('alert');
      expect(dictate(el)?.data).toMatchObject({ label: 'Dicter' });
    });

    it('where the browser cannot dictate, has no « Dicter » and says nothing of it', async () => {
      const el = await render(NoteIdeaDialog, missing);
      expect(dictate(el)).toBeNull();
      expect(el.shadowRoot?.querySelector('.dictation-error, .notice, .rec')).toBeNull();
    });
  });
});
