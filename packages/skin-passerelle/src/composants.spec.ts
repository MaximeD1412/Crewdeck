/// <reference types="vite/client" />
// What the core loads before the Skin (apps/web/src/main.ts): the tokens and the document's ground.
import './tokens.css';
import './document.css';
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

type Rgba = readonly [number, number, number, number];

const parseColor = (value: string): Rgba => {
  const [r = 0, g = 0, b = 0, a = 1] = (value.match(/[\d.]+/g) ?? []).map(Number);
  return [r, g, b, a];
};

/** The first opaque background behind an element, through its shadow hosts, up to the canvas. */
const groundBehind = (el: Element): Rgba => {
  for (let node: Element | null = el; node; ) {
    const color = parseColor(getComputedStyle(node).backgroundColor);
    if (color[3] === 1) return color;
    node = node.parentElement ?? ((node.getRootNode() as ShadowRoot).host ?? null);
  }
  return [255, 255, 255, 1];
};

const luminance = ([r, g, b]: Rgba): number => {
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
};

const contrast = (el: Element): number => {
  const [light, dark] = [luminance(parseColor(getComputedStyle(el).color)), luminance(groundBehind(el))].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (light + 0.05) / (dark + 0.05);
};

describe('the rendered page', () => {
  it('lies on the --cd-ground, not the browser white', async () => {
    const el = await render(COMPOSANTS.PageIntrouvable, {});
    const probe = document.createElement('div');
    probe.style.background = 'var(--cd-ground)';
    document.body.append(probe);
    expect(groundBehind(el)).toEqual(parseColor(getComputedStyle(probe).backgroundColor));
  });

  it('keeps the title and the link at a contrast of 4.5:1 at least (WCAG AA)', async () => {
    const el = await render(COMPOSANTS.PageIntrouvable, {});
    const parts = [...(el.shadowRoot?.querySelectorAll('h1, a') ?? [])];
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(contrast(part)).toBeGreaterThanOrEqual(4.5);
  });
});
