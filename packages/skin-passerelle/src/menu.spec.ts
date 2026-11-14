/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS, t } from '@crewdeck/sdk';
import { actionsOf, deepActiveElement, defineSkin, inside, render, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

const item = (id: string, label: string, extra: Partial<{ detail: string; selected: boolean; disabled: boolean }> = {}) => ({
  id,
  label,
  icon: 'user' as const,
  detail: extra.detail ?? null,
  selected: extra.selected ?? false,
  disabled: extra.disabled ?? false,
});

const MENU = {
  title: 'Attacher à « Review »',
  groups: [
    {
      label: 'Rôle (un seul)',
      items: [item('role-review', 'Review', { detail: 'Codex · gpt-5.5', selected: true }), item('role-conception', 'Conception')],
    },
    { label: 'Serveur MCP', items: [item('mcp-stitch', 'Stitch', { disabled: true }), item('mcp-figma', 'Figma')] },
    { label: 'Connecteur', items: [item('github', 'GitHub'), item('linear', 'Linear', { disabled: true })] },
  ],
};

const items = (el: Element) => [...(el.shadowRoot?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
const byId = (el: Element, id: string) => inside(el, `[role=menuitem][data-id="${id}"]`);
const focusedId = () => (deepActiveElement() as HTMLElement | null)?.dataset['id'];
const press = (key: string) =>
  deepActiveElement()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));

describe('Menu', () => {
  it('is a menu named by its title, a group per group named by its label, a menuitem per item', async () => {
    const el = await render(COMPOSANTS.Menu, MENU);
    const menu = inside(el, '[role=menu]');
    expect(menu.getAttribute('aria-labelledby')).toBe('title');
    expect(textOf(inside(el, '#title'))).toBe('Attacher à « Review »');
    const groups = [...menu.querySelectorAll(':scope > [role=group]')];
    expect(groups.map((group) => textOf(inside(el, `#${group.getAttribute('aria-labelledby')}`)))).toEqual([
      'Rôle (un seul)',
      'Serveur MCP',
      'Connecteur',
    ]);
    expect(groups.map((group) => group.querySelectorAll('[role=menuitem]').length)).toEqual([2, 2, 2]);
  });

  it('shows each item’s label in bold over its detail, a check when selected, aria-disabled when disabled', async () => {
    const el = await render(COMPOSANTS.Menu, MENU);
    const review = byId(el, 'role-review');
    expect(textOf(review.querySelector('b'))).toBe('Review');
    expect(textOf(review.querySelector('.detail'))).toBe('Codex · gpt-5.5');
    expect(review.querySelector('cd-icon.check')).not.toBeNull();
    expect(textOf(review.querySelector('.visually-hidden'))).toBe(t('menu.selected'));
    expect(byId(el, 'role-conception').querySelector('cd-icon.check')).toBeNull();
    expect(byId(el, 'role-conception').querySelector('.detail')).toBeNull();
    expect(byId(el, 'mcp-stitch').getAttribute('aria-disabled')).toBe('true');
    expect(byId(el, 'mcp-figma').hasAttribute('aria-disabled')).toBe(false);
  });

  it('has no title without one', async () => {
    const el = await render(COMPOSANTS.Menu, { ...MENU, title: null });
    expect(el.shadowRoot?.querySelector('#title')).toBeNull();
    expect(inside(el, '[role=menu]').hasAttribute('aria-labelledby')).toBe(false);
  });

  it('puts the focus on its first enabled item when it is rendered', async () => {
    await render(COMPOSANTS.Menu, { ...MENU, groups: [MENU.groups[1], MENU.groups[0]] });
    expect(focusedId()).toBe('mcp-figma');
  });

  it('keeps a single item in the tab order, the focused one', async () => {
    const el = await render(COMPOSANTS.Menu, MENU);
    expect(items(el).map((node) => node.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
    press('ArrowDown');
    expect(items(el).map((node) => node.tabIndex)).toEqual([-1, 0, -1, -1, -1, -1]);
  });

  it('moves with ArrowDown from the last item of a group to the first enabled one of the next, skipping disabled items', async () => {
    await render(COMPOSANTS.Menu, MENU);
    expect(focusedId()).toBe('role-review');
    press('ArrowDown');
    expect(focusedId()).toBe('role-conception');
    press('ArrowDown');
    expect(focusedId()).toBe('mcp-figma');
    press('ArrowDown');
    expect(focusedId()).toBe('github');
    press('ArrowDown');
    expect(focusedId()).toBe('role-review');
  });

  it('moves back with ArrowUp, wrapping to the last enabled item, and to the ends with Home and End', async () => {
    await render(COMPOSANTS.Menu, MENU);
    press('ArrowUp');
    expect(focusedId()).toBe('github');
    press('ArrowUp');
    expect(focusedId()).toBe('mcp-figma');
    press('ArrowUp');
    expect(focusedId()).toBe('role-conception');
    press('Home');
    expect(focusedId()).toBe('role-review');
    press('End');
    expect(focusedId()).toBe('github');
  });

  it.each(['Enter', ' '])('emits choose with the focused item’s id on « %s »', async (key) => {
    await render(COMPOSANTS.Menu, MENU);
    press('ArrowDown');
    expect(await actionsOf(() => press(key))).toEqual([{ composant: 'Menu', action: 'choose', payload: { id: 'role-conception' } }]);
  });

  it('emits choose on a click of an item', async () => {
    const el = await render(COMPOSANTS.Menu, MENU);
    expect(await actionsOf(() => byId(el, 'mcp-figma').click())).toEqual([
      { composant: 'Menu', action: 'choose', payload: { id: 'mcp-figma' } },
    ]);
  });

  it('emits nothing for a disabled item, clicked or focused', async () => {
    const el = await render(COMPOSANTS.Menu, MENU);
    const stitch = byId(el, 'mcp-stitch');
    expect(await actionsOf(() => stitch.click())).toEqual([]);
    stitch.focus();
    expect(await actionsOf(() => press('Enter'))).toEqual([]);
  });

  it('emits close on Escape', async () => {
    await render(COMPOSANTS.Menu, MENU);
    expect(await actionsOf(() => press('Escape'))).toEqual([{ composant: 'Menu', action: 'close', payload: {} }]);
  });

  it('takes the focus itself when every item is disabled, so Escape still closes it', async () => {
    const disabled = { title: null, groups: [{ label: 'Serveur MCP', items: [item('mcp-stitch', 'Stitch', { disabled: true })] }] };
    const el = await render(COMPOSANTS.Menu, disabled);
    expect(deepActiveElement()).toBe(inside(el, '[role=menu]'));
    expect(items(el).map((node) => node.tabIndex)).toEqual([-1]);
    expect(await actionsOf(() => press('Escape'))).toEqual([{ composant: 'Menu', action: 'close', payload: {} }]);
    expect(await actionsOf(() => press('ArrowDown'))).toEqual([]);
    expect(deepActiveElement()).toBe(inside(el, '[role=menu]'));
  });

  it('emits close on a pointer down outside it, and not inside', async () => {
    const el = await render(COMPOSANTS.Menu, MENU);
    const outside = document.createElement('button');
    document.body.append(outside);
    const down = (target: Element) => target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect(await actionsOf(() => down(byId(el, 'role-conception')))).toEqual([]);
    expect(await actionsOf(() => down(outside))).toEqual([{ composant: 'Menu', action: 'close', payload: {} }]);
  });

  it('stops listening outside once removed', async () => {
    const el = await render(COMPOSANTS.Menu, MENU);
    el.remove();
    expect(await actionsOf(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))).toEqual([]);
  });
});
