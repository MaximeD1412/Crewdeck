/// <reference types="vite/client" />
import './tokens.css';
import './document.css';
import { CD_ACTION, COMPOSANTS, type CdActionDetail } from '@crewdeck/sdk';
import type { LitElement } from 'lit';
import { page, userEvent } from 'vitest/browser';
import passerelle from './index.js';
import { fillSlots } from './slots.js';

beforeAll(() => {
  for (const [name, impl] of Object.entries(passerelle.composants)) {
    const declaration = COMPOSANTS[name as keyof typeof COMPOSANTS];
    if (impl && !customElements.get(declaration.tag)) customElements.define(declaration.tag, impl);
  }
});

afterEach(() => document.body.replaceChildren());

type Data = (typeof COMPOSANTS.Cadre.examples)[number]['data'];
const [withCounts, offline, resync, bare] = COMPOSANTS.Cadre.examples;

/** Waits for `root` and every Composant inside it, light and shadow. */
const settle = async (root: Element): Promise<void> => {
  const pending = [root, ...root.querySelectorAll('*'), ...(root.shadowRoot?.querySelectorAll('*') ?? [])];
  for (const el of pending) {
    if (el.localName.startsWith('cd-')) {
      await (el as LitElement).updateComplete;
      if (el !== root) await settle(el);
    }
  }
};

/** A Cadre from one of its examples, its data overridden by `data`, its Emplacements extended by `slots`. */
const cadre = async (
  example = withCounts,
  { data = {}, slots = {} }: { data?: Partial<Data>; slots?: Record<string, string> } = {},
) => {
  const el = document.createElement('cd-cadre') as LitElement & { data: unknown };
  el.data = { ...example?.data, ...data };
  el.append(...fillSlots({ ...example?.slots, ...slots }));
  document.body.append(el);
  await settle(el);
  return el;
};

const shadow = <E extends Element = HTMLElement>(el: Element, selector: string): E => {
  const found = el.shadowRoot?.querySelector<E>(selector);
  if (!found) throw new Error(`nothing at ${selector}`);
  return found;
};

const textOf = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();
const isShown = (el: Element) => el.checkVisibility();

/** The link inside each entry the Cadre shows, in the order a sighted Pilote reads them (top to bottom, left to right). */
const shownEntries = (el: Element) =>
  [...el.querySelectorAll('cd-menu-item')]
    .map((item) => shadow(item, 'a'))
    .filter(isShown)
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left);

const labelOf = (link: Element) => textOf(link.querySelector('.label'));

const actionsOf = async (act: () => unknown): Promise<CdActionDetail[]> => {
  const details: CdActionDetail[] = [];
  const listener = (event: Event) => details.push((event as CustomEvent<CdActionDetail>).detail);
  document.addEventListener(CD_ACTION, listener);
  try {
    await act();
  } finally {
    document.removeEventListener(CD_ACTION, listener);
  }
  return details;
};

/** The value of a token, as the browser computes a colour. */
const tokenColour = (token: string) => {
  const probe = document.createElement('div');
  probe.style.color = `var(${token})`;
  document.body.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
};

const PANEL = '<section aria-label="Session">La Session.</section>';
const ALL = ['À toi', 'Idées', 'Conceptions', 'Boucle', 'Planning', 'Statistiques', 'Projets', 'Runner et Comptes IA', 'Paramètres'];

describe('the Cadre at 1280 px', () => {
  beforeEach(async () => {
    await page.viewport(1280, 800);
  });

  it('shows the sidebar: the brand, the nine entries in order with the separator after the fourth, the current one marked', async () => {
    const el = await cadre();
    const nav = shadow(el, 'nav');
    expect(nav.getAttribute('aria-label')).toBe('Menu');
    expect(textOf(shadow(el, '.side .brand'))).toBe('Crewdeck');
    expect(isShown(shadow(el, '.side .brand'))).toBe(true);
    expect(isShown(shadow(el, 'header'))).toBe(false);

    const links = shownEntries(el);
    expect(links.map(labelOf)).toEqual(ALL);
    const separator = nav.querySelector('hr') as Element;
    const top = (node: Element) => node.getBoundingClientRect().top;
    expect(top(separator)).toBeGreaterThan(top(links[3] as Element));
    expect(top(separator)).toBeLessThan(top(links[4] as Element));
    expect(links.filter((link) => link.getAttribute('aria-current') === 'page').map(labelOf)).toEqual(['À toi']);
    expect(isShown(shadow(el, '.more'))).toBe(false);
  });

  it('shows the counts of À toi, Idées, Conceptions and Boucle', async () => {
    const el = await cadre();
    expect(shownEntries(el).map((link) => [...link.querySelectorAll('.count')].filter(isShown).map(textOf).join(''))).toEqual([
      '9',
      '4',
      '2',
      '2',
      '',
      '',
      '',
      '',
      '',
    ]);
  });

  it('shows at its foot the status, « En direct » and the Pilote, whose avatar emits openPilot', async () => {
    const el = await cadre();
    const foot = shadow(el, '.foot');
    expect(textOf(foot.querySelector('.status'))).toBe('Runner en ligne Claude Code, Codex');
    expect(isShown(foot.querySelector('.live') as Element)).toBe(true);
    expect(textOf(foot.querySelector('.live'))).toBe('En direct');
    const pilot = foot.querySelector('button.pilot') as HTMLButtonElement;
    expect(textOf(pilot)).toBe('MA maximed1412');
    const details = await actionsOf(() => pilot.click());
    expect(details).toEqual([{ composant: 'Cadre', action: 'openPilot', payload: {} }]);
  });

  it('shows the Pilote’s avatar from its URL', async () => {
    const el = await cadre(withCounts, { data: { pilot: { displayName: 'maximed1412', avatarUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' } } });
    const img = shadow(el, '.pilot img');
    expect(img.getAttribute('src')).toMatch(/^data:image\/gif/);
    expect(img.getAttribute('alt')).toBe('');
  });

  it('names the Pilote by its displayName, its initials standing for a missing avatar', async () => {
    const el = await cadre(withCounts, { data: { pilot: { displayName: 'pilote', avatarUrl: null } } });
    expect(textOf(shadow(el, '.pilot .avatar'))).toBe('PI');
    expect(textOf(shadow(el, '.pilot .name'))).toBe('pilote');
  });

  it('hides « En direct » when the Runner is not online, and the Pilote when there is none', async () => {
    const el = await cadre(resync, { data: { live: true } });
    expect(el.shadowRoot?.querySelector('.foot .live')).toBeNull();
    expect(el.shadowRoot?.querySelector('.foot .pilot')).toBeNull();
  });

  it('says « Resynchronisation… » with « Actions sensibles indisponibles » during the Resynchronisation', async () => {
    const el = await cadre(resync);
    expect(textOf(shadow(el, '.foot .status'))).toBe('Resynchronisation… Actions sensibles indisponibles');
    expect(getComputedStyle(shadow(el, '.foot .status .label')).color).toBe(tokenColour('--cd-caution'));
  });

  it('says « Runner hors ligne » in halt when the Runner is offline', async () => {
    const el = await cadre(offline);
    expect(textOf(shadow(el, '.foot .status'))).toBe('Runner hors ligne');
    expect(getComputedStyle(shadow(el, '.foot .status .label')).color).toBe(tokenColour('--cd-halt'));
  });

  it('puts the page in main, at most --cd-page-max wide, --cd-space-10 from the sidebar', async () => {
    const el = await cadre();
    const main = shadow(el, 'main');
    expect(main.getAttribute('aria-label')).toBe('À toi');
    expect(textOf(main.querySelector('slot')?.assignedElements()[0])).toBe('Le contenu de la page.');
    const side = shadow(el, '.side').getBoundingClientRect();
    const content = (main.querySelector('slot')?.assignedElements()[0] as Element).getBoundingClientRect();
    expect(content.left - side.right).toBeCloseTo(40, 0);
  });

  it('opens the panel on the right, --cd-panel-width wide, beside the page', async () => {
    const el = await cadre(withCounts, { slots: { panel: PANEL } });
    const aside = shadow(el, 'aside');
    expect(aside.getAttribute('aria-label')).toBe('Panneau');
    const rect = aside.getBoundingClientRect();
    expect(rect.right).toBeCloseTo(1280, 0);
    expect(rect.width).toBeCloseTo(576, 0);
    expect(isShown(shadow(el, 'main'))).toBe(true);
    expect(shadow(el, 'main').getBoundingClientRect().right).toBeLessThanOrEqual(rect.left + 1);
  });

  it('hides the panel without one', async () => {
    const el = await cadre();
    expect(isShown(shadow(el, 'aside'))).toBe(false);
  });

  it('bare: only the brand above the page, no menu', async () => {
    const el = await cadre(bare);
    expect(el.shadowRoot?.querySelector('nav')).toBeNull();
    expect(el.shadowRoot?.querySelector('.foot')).toBeNull();
    expect(textOf(shadow(el, 'header'))).toBe('Crewdeck');
    expect(textOf(shadow<HTMLSlotElement>(el, 'main slot').assignedElements()[0])).toBe('Le contenu de la page.');
  });
});

describe('the Cadre at 390 px', () => {
  beforeEach(async () => {
    await page.viewport(390, 844);
  });

  it('shows the top bar with the brand and « En direct » when live, and no sidebar', async () => {
    const el = await cadre();
    const header = shadow(el, 'header');
    expect(isShown(header)).toBe(true);
    expect(textOf(header)).toBe('Crewdeck En direct');
    expect(isShown(shadow(el, '.side .brand'))).toBe(false);
    expect(isShown(shadow(el, '.foot'))).toBe(false);
  });

  it.each([
    [offline, 'Runner hors ligne', '--cd-halt'],
    [resync, 'Resynchronisation…', '--cd-caution'],
  ] as const)('shows the status in the top bar when not live: %#', async (example, label, token) => {
    const el = await cadre(example);
    const status = shadow(el, 'header .status');
    expect(textOf(status)).toBe(label);
    expect(getComputedStyle(status).color).toBe(tokenColour(token));
  });

  it('shows the tab bar at the bottom: À toi, Idées, Conceptions, Boucle and Plus, the count on À toi only', async () => {
    const el = await cadre();
    const links = shownEntries(el);
    expect(links.map(labelOf)).toEqual(['À toi', 'Idées', 'Conceptions', 'Boucle']);
    const more = shadow(el, 'button.more');
    expect(isShown(more)).toBe(true);
    expect(textOf(more)).toBe('Plus');
    const bottoms = [...links, more].map((node) => node.getBoundingClientRect().bottom);
    for (const bottom of bottoms) expect(bottom).toBeCloseTo(844, 0);
    expect(links.map((link) => [...link.querySelectorAll('.count')].filter(isShown).map(textOf).join(''))).toEqual(['9', '', '', '']);
    for (const target of [...links, more]) expect(target.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });

  it('« Plus » opens the modal sheet with the five other entries and their metas', async () => {
    const el = await cadre(offline);
    const dialog = shadow<HTMLDialogElement>(el, 'dialog');
    expect(dialog.open).toBe(false);
    shadow(el, 'button.more').click();
    await settle(el);
    expect(dialog.open).toBe(true);
    expect(dialog.matches(':modal')).toBe(true);
    expect(textOf(dialog.querySelector('h2'))).toBe('Plus');
    expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('h2')?.id);
    const inSheet = (link: Element) => dialog.contains((link.getRootNode() as ShadowRoot).host.assignedSlot);
    const rows = shownEntries(el).filter(inSheet);
    expect(rows.map((row) => [labelOf(row), textOf(row.querySelector('.meta')) ?? ''])).toEqual([
      ['Planning', 'Jalons et arbre des Tickets'],
      ['Statistiques', 'Délai, réussite de la Boucle, coût'],
      ['Projets', ''],
      ['Runner et Comptes IA', ''],
      ['Paramètres', 'Rôles, notifications, Planifications'],
    ]);
    expect(rows.filter((row) => row.getAttribute('aria-current') === 'page').map(labelOf)).toEqual(['Planning']);
  });

  it('marks « Plus » as current when the current entry is in it', async () => {
    const el = await cadre(offline);
    expect(shadow(el, 'button.more').classList.contains('current')).toBe(true);
    const other = await cadre();
    expect(shadow(other, 'button.more').classList.contains('current')).toBe(false);
  });

  it('Escape closes the sheet and gives the focus back to « Plus »', async () => {
    const el = await cadre();
    const more = shadow(el, 'button.more');
    more.focus();
    more.click();
    const dialog = shadow<HTMLDialogElement>(el, 'dialog');
    expect(dialog.open).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(dialog.open).toBe(false);
    expect(el.shadowRoot?.activeElement).toBe(more);
  });

  it('« Fermer » closes the sheet and gives the focus back to « Plus »', async () => {
    const el = await cadre();
    const more = shadow(el, 'button.more');
    more.focus();
    more.click();
    const dialog = shadow<HTMLDialogElement>(el, 'dialog');
    const close = dialog.querySelector('cd-icon-button') as HTMLElement;
    expect(close.shadowRoot?.querySelector('button')?.getAttribute('aria-label')).toBe('Fermer');
    close.shadowRoot?.querySelector('button')?.click();
    expect(dialog.open).toBe(false);
    expect(el.shadowRoot?.activeElement).toBe(more);
  });

  it('closes the sheet when an entry of it is followed', async () => {
    const el = await cadre();
    shadow(el, 'button.more').click();
    const dialog = shadow<HTMLDialogElement>(el, 'dialog');
    const planning = [...el.querySelectorAll('cd-menu-item')].find((item) => labelOf(shadow(item, 'a')) === 'Planning') as Element;
    const stop = (event: Event) => event.preventDefault();
    document.addEventListener('click', stop);
    shadow(planning, 'a').click();
    document.removeEventListener('click', stop);
    expect(dialog.open).toBe(false);
  });

  it('covers the screen with the panel', async () => {
    const el = await cadre(withCounts, { slots: { panel: PANEL } });
    const rect = shadow(el, 'aside').getBoundingClientRect();
    expect([rect.left, rect.top, rect.width]).toEqual([0, 0, 390]);
    expect(rect.height).toBeGreaterThanOrEqual(844);
    expect(isShown(shadow(el, 'header'))).toBe(false);
    expect(shownEntries(el)).toEqual([]);
  });

  it('bare: only the brand above the page, centred', async () => {
    const el = await cadre(bare);
    expect(textOf(shadow(el, 'header'))).toBe('Crewdeck');
    expect(el.shadowRoot?.querySelector('nav, dialog, .more')).toBeNull();
  });
});
