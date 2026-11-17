/// <reference types="vite/client" />
import './tokens.css';
import './document.css';
import { COMPOSANTS, SIGN_IN_ERRORS, t, type ComposantData } from '@crewdeck/sdk';
import { page } from 'vitest/browser';
import { actionsOf, defineSkin, inside, render, settle, textOf } from './testing/dom.js';

beforeAll(defineSkin);

afterEach(async () => {
  document.body.replaceChildren();
  await page.viewport(1280, 800);
});

type Data = ComposantData<typeof COMPOSANTS.PageConnexion>;
const NOMINAL: Data = { error: null, sentTo: null, emailError: null, busy: false };

const buttonData = (el: Element, selector: string) => (inside(el, selector) as HTMLElement & { data: Record<string, unknown> }).data;

/** Types `value` in the email field, as the Pilote does. */
const type = (el: Element, value: string) => {
  const input = inside<HTMLInputElement>(el, 'cd-text-field', 'input');
  input.value = value;
  input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
  return input;
};

describe('PageConnexion', () => {
  it('welcomes the Pilote: the email field and « Recevoir un lien », then « ou » and the secondary GitHub button, then the help', async () => {
    const el = await render(COMPOSANTS.PageConnexion, NOMINAL);
    expect(textOf(inside(el, 'h1'))).toBe('Bienvenue sur Crewdeck');
    expect(textOf(inside(el, '[part=lead]'))).toBe(t('connexion.lead'));
    const input = inside<HTMLInputElement>(el, 'cd-text-field', 'input');
    expect(input.labels?.[0] && textOf(input.labels[0])).toBe('Ton adresse e-mail');
    expect((inside(el, 'cd-text-field') as HTMLElement & { data: { name: string } }).data.name).toBe('email');
    expect(buttonData(el, 'cd-button.request')).toMatchObject({ label: 'Recevoir un lien', variant: 'primary', icon: 'send' });
    expect(buttonData(el, 'cd-button.request').state).toBeUndefined();
    expect(textOf(inside(el, '[part=or]'))).toBe('ou');
    expect(buttonData(el, 'cd-button.github')).toMatchObject({ label: 'Continuer avec GitHub', variant: 'secondary', icon: 'github' });
    expect(textOf(inside(el, '[part=help]'))).toBe('Pas de mot de passe : un lien par e-mail, ou ton compte GitHub.');
    expect(el.shadowRoot?.querySelector('cd-banner')).toBeNull();
    const order = ['cd-text-field', 'cd-button.request', '[part=or]', 'cd-button.github', '[part=help]'].map((selector) => inside(el, selector));
    for (const [index, node] of order.slice(1).entries()) {
      expect(order[index]?.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('« Recevoir un lien » emits requestLink with the address typed', async () => {
    const el = await render(COMPOSANTS.PageConnexion, NOMINAL);
    type(el, 'pilote@example.com');
    const actions = await actionsOf(() => inside(el, 'cd-button.request', 'button').click());
    expect(actions).toEqual([{ composant: 'PageConnexion', action: 'requestLink', payload: { email: 'pilote@example.com' } }]);
  });

  it('Enter in the field emits requestLink too', async () => {
    const el = await render(COMPOSANTS.PageConnexion, NOMINAL);
    const input = type(el, 'pilote@example.com');
    const actions = await actionsOf(() =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true })),
    );
    expect(actions).toEqual([{ composant: 'PageConnexion', action: 'requestLink', payload: { email: 'pilote@example.com' } }]);
  });

  it('« Continuer avec GitHub » emits signInWith github', async () => {
    const el = await render(COMPOSANTS.PageConnexion, NOMINAL);
    const actions = await actionsOf(() => inside(el, 'cd-button.github', 'button').click());
    expect(actions).toEqual([{ composant: 'PageConnexion', action: 'signInWith', payload: { provider: 'github' } }]);
  });

  it('busy, « Recevoir un lien » is loading and nothing is requested again, the address kept', async () => {
    const el = await render(COMPOSANTS.PageConnexion, NOMINAL);
    type(el, 'pilote@example.com');
    el.data = { ...NOMINAL, busy: true };
    await settle(el);
    expect(buttonData(el, 'cd-button.request').state).toBe('loading');
    const actions = await actionsOf(async () => {
      inside(el, 'cd-button.request', 'button').click();
      inside(el, 'cd-text-field', 'input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
    });
    expect(actions).toEqual([]);
    expect(inside<HTMLInputElement>(el, 'cd-text-field', 'input').value).toBe('pilote@example.com');
  });

  it('shows the address the server refused under the field, the address kept', async () => {
    const el = await render(COMPOSANTS.PageConnexion, NOMINAL);
    type(el, 'pilote@');
    el.data = { ...NOMINAL, emailError: 'Adresse e-mail invalide.' };
    await settle(el);
    expect(textOf(inside(el, 'cd-text-field', '.error'))).toBe('Adresse e-mail invalide.');
    expect(inside(el, 'cd-text-field', 'input').getAttribute('aria-invalid')).toBe('true');
    expect(inside<HTMLInputElement>(el, 'cd-text-field', 'input').value).toBe('pilote@');
  });

  it.each(SIGN_IN_ERRORS.map((error) => [error] as const))('shows the halt banner of %s above the field', async (error) => {
    const el = await render(COMPOSANTS.PageConnexion, { ...NOMINAL, error });
    const banner = inside(el, 'cd-banner') as HTMLElement & { data: unknown };
    expect(banner.data).toMatchObject({ tone: 'halt', title: t(`connexion.error.${error}`) });
    expect(inside(banner, '[role=alert]')).toBeTruthy();
    expect(banner.compareDocumentPosition(inside(el, 'cd-text-field')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names the messages of the link’s request as the server does', () => {
    expect(t('connexion.error.too-many-requests')).toBe('Trop de liens demandés : réessaie dans une heure.');
    expect(t('connexion.error.mail-unavailable')).toBe('L’e-mail n’a pas pu partir, réessaie dans un instant.');
    expect(t('connexion.error.link-invalid')).toBe('Ce lien de connexion n’est plus valable : demande-en un nouveau.');
  });

  it('once the link is sent, a go banner with the address and « Changer d’adresse » take the field’s place', async () => {
    const el = await render(COMPOSANTS.PageConnexion, { ...NOMINAL, sentTo: 'pilote@example.com' });
    expect(el.shadowRoot?.querySelector('cd-text-field')).toBeNull();
    expect(el.shadowRoot?.querySelector('cd-button.request')).toBeNull();
    const banner = inside(el, 'cd-banner') as HTMLElement & { data: unknown };
    expect(banner.data).toMatchObject({ tone: 'go', title: 'Lien envoyé à pilote@example.com' });
    expect(textOf(banner.querySelector('[part=sent-text]'))).toBe('Ouvre-le dans les 15 minutes, sur cet appareil ou un autre.');
    const change = inside(el, 'cd-button.change') as HTMLElement & { data: unknown };
    expect(change.getAttribute('slot')).toBe('actions');
    expect(change.data).toMatchObject({ label: 'Changer d’adresse', variant: 'ghost' });
    expect(buttonData(el, 'cd-button.github')).toMatchObject({ label: 'Continuer avec GitHub' });
    const actions = await actionsOf(() => inside(el, 'cd-button.change', 'button').click());
    expect(actions).toEqual([{ composant: 'PageConnexion', action: 'changeEmail', payload: {} }]);
  });

  it('back to the field after « Changer d’adresse », the address sent is in it', async () => {
    const el = await render(COMPOSANTS.PageConnexion, NOMINAL);
    type(el, 'pilote@example.com');
    el.data = { ...NOMINAL, sentTo: 'pilote@example.com' };
    await settle(el);
    el.data = NOMINAL;
    await settle(el);
    expect(inside<HTMLInputElement>(el, 'cd-text-field', 'input').value).toBe('pilote@example.com');
  });

  it('at 390 px, the buttons span the column', async () => {
    await page.viewport(390, 800);
    const el = await render(COMPOSANTS.PageConnexion, NOMINAL);
    const width = inside(el, 'cd-text-field', 'input').getBoundingClientRect().width;
    for (const selector of ['cd-button.request', 'cd-button.github']) {
      expect(inside(el, selector, 'button').getBoundingClientRect().width).toBeCloseTo(width, 0);
    }
  });
});
