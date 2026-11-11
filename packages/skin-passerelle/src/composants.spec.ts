/// <reference types="vite/client" />
// What the core loads before the Skin (apps/web/src/main.ts): the tokens and the document's ground.
import './tokens.css';
import './document.css';
import { COMPOSANTS, t, zCdActionDetail } from '@crewdeck/sdk';
import type { LitElement } from 'lit';
import { COPIED_MS } from './code-block.js';
import passerelle from './index.js';
import { actionsOf, defineSkin, inside, render, settle, textOf } from './testing/dom.js';

beforeAll(defineSkin);

/** How each declared action is set off from the first example: a test fails for an action without one. */
const TRIGGERS: Readonly<Record<string, (el: Element & { data: unknown }) => unknown>> = {
  'Dialog.close': (el) => inside(el, 'cd-icon-button', 'button').click(),
  'Cadre.openPilot': (el) => inside(el, 'button.pilot').click(),
  'ProjectFilter.select': (el) => inside(el, 'cd-chip:nth-of-type(2)', 'button').click(),
  'Tabs.select': (el) => inside(el, 'button[role=tab]:nth-of-type(2)').click(),
  'DecisionRow.open': (el) => inside(el, '.open').click(),
  'IdeaRow.open': (el) => inside(el, '.open').click(),
  'AgentRow.open': (el) => inside(el, 'button').click(),
  'Capture.open': (el) => inside(el, 'button').click(),
  'PageComposants.select': (el) => inside(el, 'nav cd-list-row:not(:has(cd-status-badge))', 'a').click(),
  'Session.stop': (el) => inside(el, 'cd-button.stop', 'button').click(),
  'Session.resume': async (el) => {
    el.data = { ...(el.data as object), state: 'stopped' };
    await settle(el);
    inside(el, 'cd-button.resume', 'button').click();
  },
  'Session.close': (el) => inside(el, 'cd-icon-button.close', 'button').click(),
  'Session.expand': (el) => inside(el, 'cd-icon-button.expand', 'button').click(),
  'Question.answer': (el) => inside(el, 'cd-button.answer', 'button').click(),
  'PermissionRequest.allow': (el) => inside(el, 'cd-button.allow', 'button').click(),
  'PermissionRequest.allowForSession': (el) => inside(el, 'cd-button.allow-for-session', 'button').click(),
  'PermissionRequest.deny': (el) => inside(el, 'cd-button.deny', 'button').click(),
  'Composer.send': async (el) => {
    const field = inside<HTMLTextAreaElement>(el, 'textarea');
    field.value = 'Pense aux événements récurrents.';
    field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await settle(el);
    inside(el, 'button.send').click();
  },
  'Composer.dictate': (el) => inside(el, 'button.mic').click(),
  'Composer.stopDictation': async (el) => {
    el.data = { ...(el.data as object), state: 'dictating' };
    await settle(el);
    inside(el, 'button.mic').click();
  },
  'PageConnexion.signIn': (el) => inside(el, 'cd-button', 'button').click(),
  'PageDemarrage.selectSystem': (el) => inside(el, 'cd-tabs', 'button[role=tab]:nth-of-type(2)').click(),
  'PageDemarrage.retry': async (el) => {
    el.data = { ...(el.data as object), failure: { reason: 'expired', shortId: '9RTB' } };
    await settle(el);
    inside(el, 'cd-button.retry', 'button').click();
  },
  'PageDemarrage.continue': async (el) => {
    el.data = COMPOSANTS.PageDemarrage.examples[2]?.data;
    await settle(el);
    inside(el, 'cd-button.continue', 'button').click();
  },
  'PageParametres.change': (el) => {
    const native = inside<HTMLSelectElement>(el.querySelector('cd-select') as Element, 'select');
    native.value = 'Asia/Tokyo';
    native.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    native.dispatchEvent(new Event('change', { bubbles: true }));
  },
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

      it.each(Object.keys(declaration.actions).map((action) => [action] as const))(
        'emits a valid cd-action for « %s »',
        async (action) => {
          const trigger = TRIGGERS[`${declaration.name}.${action}`];
          expect(trigger, `no trigger for ${declaration.name}.${action}`).toBeDefined();
          const [example] = declaration.examples;
          const el = await render(declaration, example?.data, example?.slots as Record<string, string> | undefined);
          const details = await actionsOf(() => trigger?.(el as Element & { data: unknown }));
          expect(details).toHaveLength(1);
          const detail = zCdActionDetail.parse(details[0]);
          expect(detail).toMatchObject({ composant: declaration.name, action });
          const actions: Record<string, { safeParse: (value: unknown) => { success: boolean } }> = declaration.actions;
          expect(actions[action]?.safeParse(detail.payload).success).toBe(true);
        },
      );
    },
  );
});

describe('Icon', () => {
  it('is an inline stroke SVG in the current colour, hidden from screen readers', async () => {
    const el = await render(COMPOSANTS.Icon, { name: 'bell', size: 'sm' });
    const svg = inside(el, 'svg');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.querySelector('path')).not.toBeNull();
  });
});

describe('Button', () => {
  const merge = { label: 'Merger', variant: 'primary', size: 'md', icon: 'merge' } as const;

  it('is a native button with its label', async () => {
    const el = await render(COMPOSANTS.Button, merge);
    const button = inside<HTMLButtonElement>(el, 'button');
    expect(button.type).toBe('button');
    expect(textOf(button)).toBe('Merger');
    button.focus();
    expect(el.shadowRoot?.activeElement).toBe(button);
  });

  it('disabled with a reason shows the reason beside it, describes itself with it, and is neither focusable nor pressable', async () => {
    const el = await render(COMPOSANTS.Button, { ...merge, state: 'disabled', disabledReason: 'Indisponible pendant la Resynchronisation' });
    const button = inside<HTMLButtonElement>(el, 'button');
    expect(button.disabled).toBe(true);
    const reason = inside(el, `#${button.getAttribute('aria-describedby')}`);
    expect(textOf(reason)).toBe('Indisponible pendant la Resynchronisation');
    expect(reason.getBoundingClientRect().width).toBeGreaterThan(0);
    button.focus();
    expect(el.shadowRoot?.activeElement).toBeNull();
    const pressed = vi.fn();
    document.body.addEventListener('click', pressed);
    reason.click();
    el.click();
    document.body.removeEventListener('click', pressed);
    expect(pressed).not.toHaveBeenCalled();
  });

  it.each([
    ['with an icon', merge],
    ['without an icon', { label: 'Enregistrer', variant: 'secondary', size: 'sm' }],
  ] as const)('loading %s keeps its width, busy and not pressable', async (_case, data) => {
    const idle = await render(COMPOSANTS.Button, data);
    const loading = await render(COMPOSANTS.Button, { ...data, state: 'loading' });
    const width = (el: Element) => inside(el, 'button').getBoundingClientRect().width;
    expect(width(loading)).toBeCloseTo(width(idle), 1);
    const button = inside<HTMLButtonElement>(loading, 'button');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.disabled).toBe(true);
    expect(loading.shadowRoot?.querySelector('.spinner')).not.toBeNull();
    expect(textOf(button)).toBe(data.label);
  });
});

describe('IconButton', () => {
  it('is a button named by its label', async () => {
    const el = await render(COMPOSANTS.IconButton, { icon: 'x', label: 'Fermer' });
    expect(inside(el, 'button').getAttribute('aria-label')).toBe('Fermer');
  });
});

describe('StatusDot', () => {
  it('keeps its label for screen readers only', async () => {
    const el = await render(COMPOSANTS.StatusDot, { tone: 'go', pulse: true, label: 'en ligne' });
    expect(textOf(el.shadowRoot?.querySelector('.visually-hidden'))).toBe('en ligne');
    expect(inside(el, '.dot').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Banner', () => {
  it.each([
    ['caution', 'status'],
    ['accent', 'status'],
    ['halt', 'alert'],
  ] as const)('%s is a %s', async (tone, role) => {
    const el = await render(COMPOSANTS.Banner, { tone, title: 'Runner hors ligne' });
    expect(el.shadowRoot?.querySelector(`[role=${role}]`)).not.toBeNull();
  });

  it('hides its actions’ row without actions', async () => {
    const bare = await render(COMPOSANTS.Banner, { tone: 'accent', title: 'Info' }, { default: 'Un texte.' });
    expect(inside(bare, '.actions').hidden).toBe(true);
    const full = await render(COMPOSANTS.Banner, { tone: 'accent', title: 'Info' }, { actions: '<button>Voir</button>' });
    expect(inside(full, '.actions').hidden).toBe(false);
  });
});

describe('ProjectFilter', () => {
  it('selects « Tous les Projets » with a null projectId, and a Project with its id', async () => {
    const [example] = COMPOSANTS.ProjectFilter.examples;
    const el = await render(COMPOSANTS.ProjectFilter, example?.data);
    const chips = el.shadowRoot?.querySelectorAll('cd-chip') ?? [];
    const details = await actionsOf(() => {
      for (const chip of chips) inside(chip, 'button').click();
    });
    expect(details.map((detail) => detail.payload)).toEqual(
      example?.data.chips.map((chip) => ({ projectId: chip.projectId })),
    );
    expect(details[0]?.payload).toEqual({ projectId: null });
    expect(inside(chips[0] as Element, 'button').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Tabs', () => {
  const data = {
    tabs: [
      { id: 'a', label: 'A', selected: true },
      { id: 'b', label: 'B', selected: false },
      { id: 'c', label: 'C', selected: false },
    ],
  };

  it('is a tablist where only the selected tab is in the tab order', async () => {
    const el = await render(COMPOSANTS.Tabs, data);
    const tabs = [...(el.shadowRoot?.querySelectorAll('[role=tablist] > [role=tab]') ?? [])];
    expect(tabs.map((tab) => [tab.getAttribute('aria-selected'), tab.getAttribute('tabindex')])).toEqual([
      ['true', '0'],
      ['false', '-1'],
      ['false', '-1'],
    ]);
  });

  it.each([
    ['ArrowRight', 'b'],
    ['ArrowLeft', 'c'],
    ['End', 'c'],
    ['Home', 'a'],
  ] as const)('%s from the first tab selects « %s » and moves the focus there', async (key, id) => {
    const el = await render(COMPOSANTS.Tabs, data);
    const first = inside(el, '[role=tab]');
    first.focus();
    const details = await actionsOf(() => first.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true })));
    expect(details.map((detail) => detail.payload)).toEqual([{ id }]);
    expect(textOf(el.shadowRoot?.activeElement)).toBe(id.toUpperCase());
  });
});

describe('Card', () => {
  it('is a section landmark named by its label, with its title as a heading', async () => {
    const el = await render(COMPOSANTS.Card, { title: 'Projets', count: 2, label: 'Projets' });
    expect(inside(el, 'section').getAttribute('aria-label')).toBe('Projets');
    expect(textOf(inside(el, 'h2'))).toMatch(/^Projets/);
    expect(textOf(inside(el, 'h2 .count'))).toBe('2');
    const plain = await render(COMPOSANTS.Card, { title: 'Projets' });
    expect(plain.shadowRoot?.querySelector('section')).toBeNull();
  });
});

describe('ListRow', () => {
  it('with href is a link on the whole row', async () => {
    const el = await render(COMPOSANTS.ListRow, { title: 'Runner', href: '/runner' }, { trailing: '<span>ok</span>' });
    const link = inside<HTMLAnchorElement>(el, 'a');
    expect(link.getAttribute('href')).toBe('/runner');
    expect(link.querySelector('slot[name=trailing]')).not.toBeNull();
  });
});

describe('KeyValue', () => {
  it('is a description list', async () => {
    const el = await render(COMPOSANTS.KeyValue, { items: [{ label: 'Moteur', value: 'claude', mono: true }] });
    expect(textOf(inside(el, 'dl dt'))).toBe('Moteur');
    expect(textOf(inside(el, 'dl dd'))).toBe('claude');
  });
});

describe('CodeBlock', () => {
  afterEach(() => vi.useRealTimers());

  it('copies its command and says « Copié » for 2 s', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const el = (await render(COMPOSANTS.CodeBlock, { code: 'crewdeck-runner login' })) as LitElement;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const button = inside(el, 'button');
    expect(textOf(button)).toBe(t('codeBlock.copy'));
    button.click();
    await vi.waitFor(() => expect(textOf(button)).toBe(t('codeBlock.copied')));
    expect(writeText).toHaveBeenCalledWith('crewdeck-runner login');
    expect(textOf(el.shadowRoot?.querySelector('[role=status]'))).toBe(t('codeBlock.copied'));
    vi.advanceTimersByTime(COPIED_MS);
    await el.updateComplete;
    expect(textOf(button)).toBe(t('codeBlock.copy'));
  });
});

describe('PageHeader', () => {
  it('is a header with one h1, its count and its back link', async () => {
    const el = await render(COMPOSANTS.PageHeader, { title: 'Bibliothèque', count: 'Banner', back: { label: 'Paramètres', href: '/parametres' } });
    expect(el.shadowRoot?.querySelectorAll('header h1')).toHaveLength(1);
    expect(textOf(inside(el, '.count'))).toBe('Banner');
    expect(inside(el, 'a').getAttribute('href')).toBe('/parametres');
  });
});

describe('PageComposants', () => {
  const example = COMPOSANTS.PageComposants.examples[0];

  it('lists the catalogue as links to ?c=, the open one badged « ouvert »', async () => {
    const el = await render(COMPOSANTS.PageComposants, example?.data);
    const rows = [...(el.shadowRoot?.querySelectorAll('nav cd-list-row') ?? [])];
    expect(rows.map((row) => inside(row, 'a').getAttribute('href'))).toEqual([
      '/parametres/composants?c=PageHeader',
      '/parametres/composants?c=Banner',
      '/parametres/composants?c=Button',
    ]);
    const open = rows.filter((row) => row.querySelector('cd-status-badge'));
    expect(open.map((row) => textOf(inside(row, '.title')))).toEqual(['Banner']);
    expect(textOf(inside(open[0]?.querySelector('cd-status-badge') as Element, 'span'))).toBe(t('composants.page.badge.open'));
  });

  it('names each row of the catalogue by its Composant alone, its tag and version in the open one’s card', async () => {
    const el = await render(COMPOSANTS.PageComposants, example?.data);
    const rows = [...(el.shadowRoot?.querySelectorAll('nav cd-list-row') ?? [])];
    expect(rows.map((row) => textOf(inside(row, 'a')))).toEqual(['PageHeader', 'Banner', 'Button']);
    expect(textOf(inside(el, '.contract .identity'))).toBe(`cd-banner · ${t('composants.page.version', { version: 1 })}`);
  });

  it('fits the table of the fields in a phone’s width, a long type wrapped', async () => {
    const el = await render(COMPOSANTS.PageComposants, {
      ...example?.data,
      selected: {
        ...example?.data.selected,
        fields: [{ name: 'icon', type: 'IconName | undefined', description: 'Son icône, « info » sans elle, à gauche du titre.' }],
      },
    });
    el.style.display = 'block';
    el.style.width = '390px';
    await settle(el);
    const scroller = el.shadowRoot?.querySelector('table')?.parentElement;
    expect(scroller?.scrollWidth).toBeLessThanOrEqual(scroller?.clientWidth ?? 0);
  });

  it('previews each example with the real element, its data and its Emplacements', async () => {
    const el = await render(COMPOSANTS.PageComposants, example?.data);
    const preview = inside(el, '.stage cd-banner') as HTMLElement & { data: unknown };
    expect(preview.data).toEqual(example?.data.selected.examples[0]?.data);
    expect(textOf(preview)).toBe('Un instant.');
    expect(preview.shadowRoot?.childElementCount).toBeGreaterThan(0);
  });

  it('keeps a preview’s links and actions inside it', async () => {
    const el = await render(COMPOSANTS.PageComposants, {
      ...example?.data,
      selected: {
        ...example?.data.selected,
        name: 'Tabs',
        tag: 'cd-tabs',
        examples: [{ name: 'deux', data: { tabs: [{ id: 'a', label: 'A', selected: true }, { id: 'b', label: 'B', selected: false }] } }],
      },
    });
    const details = await actionsOf(() => inside(el, '.stage cd-tabs', '[role=tab]').click());
    expect(details).toEqual([]);
  });

  it('lets the keyboard scroll the table of the fields, named after its card', async () => {
    const el = await render(COMPOSANTS.PageComposants, example?.data);
    const table = el.shadowRoot?.querySelector('table');
    const scroller = table?.parentElement;
    expect(scroller?.tabIndex).toBe(0);
    expect(scroller?.getAttribute('role')).toBe('group');
    expect(scroller?.getAttribute('aria-label')).toBe(t('composants.page.data'));
  });

  it('shows the fields with their types, the actions with their badge, the Emplacements', async () => {
    const el = await render(COMPOSANTS.PageComposants, example?.data);
    const cells = [...(el.shadowRoot?.querySelectorAll('tbody tr') ?? [])].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => textOf(cell)),
    );
    expect(cells).toEqual([
      ['tone', 'Tone', 'Sa couleur.'],
      ['title', 'string', 'Son titre.'],
    ]);
    const badges = [...(el.shadowRoot?.querySelectorAll('.contract cd-list-row cd-status-badge') ?? [])].map((badge) =>
      textOf(inside(badge, 'span')),
    );
    expect(badges).toEqual([t('composants.page.badge.free'), t('composants.page.badge.sensitive')]);
  });
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

describe('PageConnexion', () => {
  it('welcomes the Pilote, with the GitHub button and its help, and no banner', async () => {
    const el = await render(COMPOSANTS.PageConnexion, { error: null });
    expect(textOf(el.shadowRoot?.querySelector('h1'))).toBe(t('connexion.title'));
    expect(textOf(el.shadowRoot?.querySelector('[part=lead]'))).toBe(t('connexion.lead'));
    expect(textOf(el.shadowRoot?.querySelector('[part=help]'))).toBe(t('connexion.help'));
    const button = el.shadowRoot?.querySelector('cd-button') as HTMLElement & { data: unknown };
    expect(button.data).toMatchObject({ label: t('connexion.button'), variant: 'primary', icon: 'github' });
    expect(el.shadowRoot?.querySelector('cd-banner')).toBeNull();
  });

  it.each(['state-mismatch', 'denied', 'github-unavailable'] as const)('shows the halt banner of %s above the button', async (error) => {
    const el = await render(COMPOSANTS.PageConnexion, { error });
    const banner = el.shadowRoot?.querySelector('cd-banner') as HTMLElement & { data: unknown };
    expect(banner.data).toMatchObject({ tone: 'halt', title: t(`connexion.error.${error}`) });
    expect(inside(banner, '[role=alert]')).toBeTruthy();
    expect(banner.compareDocumentPosition(el.shadowRoot?.querySelector('cd-button') as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
