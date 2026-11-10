import { COMPOSANTS, t, type AnyComposant } from '@crewdeck/sdk';
import type { LitElement } from 'lit';
import passerelle from './index.js';

/** What the core does at boot: each implementation under its canonical tag. */
beforeAll(() => {
  for (const [name, impl] of Object.entries(passerelle.composants)) {
    const declaration = COMPOSANTS[name as keyof typeof COMPOSANTS];
    if (impl && !customElements.get(declaration.tag)) customElements.define(declaration.tag, impl);
  }
});

const render = async (declaration: AnyComposant, data: unknown, slots: Record<string, string> = {}) => {
  const el = document.createElement(declaration.tag) as LitElement & { data: unknown };
  el.data = data;
  el.innerHTML = Object.entries(slots)
    .map(([slot, html]) => `<div slot="${slot}">${html}</div>`)
    .join('');
  document.body.append(el);
  await el.updateComplete;
  return el;
};

afterEach(() => document.body.replaceChildren());

describe('the Passerelle Skin', () => {
  it('is the root Skin, for both targets', () => {
    expect(passerelle).toMatchObject({ id: 'passerelle', parent: null, targets: ['pc', 'telephone'] });
  });

  it('implements every Composant', () => {
    expect(Object.keys(passerelle.composants).sort()).toEqual(Object.keys(COMPOSANTS).sort());
  });

  describe.each(Object.values(COMPOSANTS).map((declaration) => [declaration.name, declaration] as const))(
    '%s',
    (_name, declaration) => {
      it.each(declaration.examples.map((example) => [example.name, example] as const))(
        'renders its example « %s » in a shadow root',
        async (_example, example) => {
          const el = await render(declaration, example.data, example.slots as Record<string, string> | undefined);
          expect(el.shadowRoot?.childElementCount).toBeGreaterThan(0);
        },
      );
    },
  );
});

describe('PageIntrouvable', () => {
  it('says the page does not exist and links back to « À toi »', async () => {
    const el = await render(COMPOSANTS.PageIntrouvable, {});
    expect(el.shadowRoot?.querySelector('h1')?.textContent?.trim()).toBe(t('router.notFound.title'));
    const link = el.shadowRoot?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/a-toi');
    expect(link?.textContent?.trim()).toBe(t('router.notFound.back'));
  });
});
