import './tokens.css';
import { COMPOSANTS } from '@crewdeck/sdk';
import { defineSkin, inside, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

describe('Toast', () => {
  it('is a status with its icon and its text, and no close button', async () => {
    const el = await render(COMPOSANTS.Toast, { tone: 'halt', icon: 'block', text: 'Cette flèche est refusée.' });
    const toast = inside(el, '[role=status]');
    expect(textOf(toast)).toBe('Cette flèche est refusée.');
    expect(toast.querySelector('cd-icon')).not.toBeNull();
    expect(el.shadowRoot?.querySelector('button, cd-icon-button, cd-button')).toBeNull();
  });

  it('may have no icon', async () => {
    const el = await render(COMPOSANTS.Toast, { tone: 'accent', icon: null, text: 'Le brouillon est enregistré.' });
    expect(inside(el, '[role=status]').querySelector('cd-icon')).toBeNull();
  });

  it('never removes itself', async () => {
    const el = await render(COMPOSANTS.Toast, { tone: 'go', icon: 'check', text: 'La version 4 du Process est active.' });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(el.isConnected).toBe(true);
    expect(el.shadowRoot?.querySelector('[role=status]')).not.toBeNull();
  });
});
