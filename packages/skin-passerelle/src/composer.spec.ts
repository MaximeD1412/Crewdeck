/// <reference types="vite/client" />
// What the core loads before the Skin (apps/web/src/main.ts): the tokens and the document's ground.
import './tokens.css';
import './document.css';
import { COMPOSANTS, t } from '@crewdeck/sdk';
import { userEvent } from 'vitest/browser';
import { actionsOf, defineSkin, inside, render, settle, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

const IDLE = { placeholder: 'Écrire à l’agent, ou dicter', hint: null, state: 'idle', value: '', dictation: true } as const;

const field = (el: Element) => inside<HTMLTextAreaElement>(el, 'textarea');

describe('Composer', () => {
  it('sends the text on Enter, then clears the field', async () => {
    const el = await render(COMPOSANTS.Composer, IDLE);
    field(el).focus();
    const details = await actionsOf(() => userEvent.keyboard('Pense aux récurrents{Enter}'));
    expect(details).toEqual([{ composant: 'Composer', action: 'send', payload: { text: 'Pense aux récurrents' } }]);
    await settle(el);
    expect(field(el).value).toBe('');
  });

  it('breaks a line on Shift+Enter, and sends both lines', async () => {
    const el = await render(COMPOSANTS.Composer, IDLE);
    field(el).focus();
    const typed = await actionsOf(() => userEvent.keyboard('Une{Shift>}{Enter}{/Shift}deux'));
    expect(typed).toEqual([]);
    expect(field(el).value).toBe('Une\ndeux');
    const sent = await actionsOf(() => inside(el, 'button.send').click());
    expect(sent.map((detail) => detail.payload)).toEqual([{ text: 'Une\ndeux' }]);
  });

  it('sends nothing while the field is empty or blank', async () => {
    const el = await render(COMPOSANTS.Composer, IDLE);
    field(el).focus();
    const details = await actionsOf(async () => {
      await userEvent.keyboard('{Enter}');
      await userEvent.keyboard('   {Enter}');
      inside(el, 'button.send').click();
    });
    expect(details).toEqual([]);
  });

  it('is named by its placeholder, the send button by « Envoyer », the default hint under it', async () => {
    const el = await render(COMPOSANTS.Composer, IDLE);
    expect(field(el).placeholder).toBe(IDLE.placeholder);
    expect(field(el).getAttribute('aria-label')).toBe(IDLE.placeholder);
    expect(inside(el, 'button.send').getAttribute('aria-label')).toBe(t('composer.send'));
    expect(textOf(inside(el, '.hint'))).toBe(t('composer.hint'));
    const hinted = await render(COMPOSANTS.Composer, { ...IDLE, hint: 'Une aide' });
    expect(textOf(inside(hinted, '.hint'))).toBe('Une aide');
  });

  it('has no mic without dictation', async () => {
    const el = await render(COMPOSANTS.Composer, { ...IDLE, dictation: false });
    expect(el.shadowRoot?.querySelector('button.mic')).toBeNull();
    expect(el.shadowRoot?.querySelector('button.send')).not.toBeNull();
  });

  it('asks to dictate with its mic, « Dicter »', async () => {
    const el = await render(COMPOSANTS.Composer, IDLE);
    const mic = inside(el, 'button.mic');
    expect(mic.getAttribute('aria-label')).toBe(t('composer.dictate'));
    expect(await actionsOf(() => mic.click())).toEqual([{ composant: 'Composer', action: 'dictate', payload: {} }]);
  });

  it('while dictating, shows the transcript, says so, and its mic stops the dictation', async () => {
    const el = await render(COMPOSANTS.Composer, { ...IDLE, state: 'dictating', value: 'Pense aux récurrents' });
    expect(field(el).value).toBe('Pense aux récurrents');
    expect(textOf(inside(el, '.recording'))).toBe(t('composer.dictating'));
    expect(el.shadowRoot?.querySelector('.hint')).toBeNull();
    const mic = inside(el, 'button.mic');
    expect(mic.getAttribute('aria-label')).toBe(t('composer.stopDictation'));
    expect(mic.getAttribute('aria-pressed')).toBe('true');
    expect(await actionsOf(() => mic.click())).toEqual([{ composant: 'Composer', action: 'stopDictation', payload: {} }]);
  });

  it('takes the value the core puts in it, for the Pilote to correct before sending', async () => {
    const el = await render(COMPOSANTS.Composer, IDLE);
    el.data = { ...IDLE, value: 'Pense aux récurrentz' };
    await settle(el);
    field(el).focus();
    field(el).setSelectionRange(field(el).value.length, field(el).value.length);
    const details = await actionsOf(() => userEvent.keyboard('{Backspace}s{Enter}'));
    expect(details.map((detail) => detail.payload)).toEqual([{ text: 'Pense aux récurrents' }]);
  });

  it('disabled, neither types nor sends', async () => {
    const el = await render(COMPOSANTS.Composer, { ...IDLE, state: 'disabled', value: 'Bonjour' });
    expect(field(el).disabled).toBe(true);
    expect(inside<HTMLButtonElement>(el, 'button.send').disabled).toBe(true);
    expect(inside<HTMLButtonElement>(el, 'button.mic').disabled).toBe(true);
    expect(await actionsOf(() => inside(el, 'button.send').click())).toEqual([]);
  });
});
