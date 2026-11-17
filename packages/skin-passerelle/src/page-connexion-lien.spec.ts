/// <reference types="vite/client" />
import './tokens.css';
import './document.css';
import { COMPOSANTS } from '@crewdeck/sdk';
import { actionsOf, defineSkin, inside, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);

afterEach(() => document.body.replaceChildren());

const buttonData = (el: Element, selector: string) => (inside(el, selector) as HTMLElement & { data: Record<string, unknown> }).data;

describe('PageConnexionLien', () => {
  it('ready: « Connexion à Crewdeck », its lead and the primary « Se connecter », which emits confirm', async () => {
    const el = await render(COMPOSANTS.PageConnexionLien, { state: 'ready' });
    expect(textOf(inside(el, 'h1'))).toBe('Connexion à Crewdeck');
    expect(textOf(inside(el, '[part=lead]'))).toBe('Un clic pour te connecter sur cet appareil.');
    expect(buttonData(el, 'cd-button.confirm')).toMatchObject({ label: 'Se connecter', variant: 'primary' });
    expect(buttonData(el, 'cd-button.confirm').state).toBeUndefined();
    expect(el.shadowRoot?.querySelector('cd-banner')).toBeNull();
    const actions = await actionsOf(() => inside(el, 'cd-button.confirm', 'button').click());
    expect(actions).toEqual([{ composant: 'PageConnexionLien', action: 'confirm', payload: {} }]);
  });

  it('busy: « Se connecter » is loading and confirms nothing again', async () => {
    const el = await render(COMPOSANTS.PageConnexionLien, { state: 'busy' });
    expect(buttonData(el, 'cd-button.confirm').state).toBe('loading');
    const actions = await actionsOf(() => inside(el, 'cd-button.confirm', 'button').click());
    expect(actions).toEqual([]);
  });

  it('invalid: the halt banner of a link no longer valid and the primary « Recevoir un nouveau lien », which emits restart', async () => {
    const el = await render(COMPOSANTS.PageConnexionLien, { state: 'invalid' });
    const banner = inside(el, 'cd-banner') as HTMLElement & { data: unknown };
    expect(banner.data).toMatchObject({ tone: 'halt', title: 'Ce lien de connexion n’est plus valable : demande-en un nouveau.' });
    expect(inside(banner, '[role=alert]')).toBeTruthy();
    expect(el.shadowRoot?.querySelector('cd-button.confirm')).toBeNull();
    expect(buttonData(el, 'cd-button.restart')).toMatchObject({ label: 'Recevoir un nouveau lien', variant: 'primary' });
    const actions = await actionsOf(() => inside(el, 'cd-button.restart', 'button').click());
    expect(actions).toEqual([{ composant: 'PageConnexionLien', action: 'restart', payload: {} }]);
  });
});
