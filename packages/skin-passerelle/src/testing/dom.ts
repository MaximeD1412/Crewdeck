/**
 * What the browser specs of the Skin share: the Skin's elements defined as the
 * core does at boot, an element rendered from its data and Emplacements, and
 * the means to look inside shadow roots and catch the `cd-action`s. Never part
 * of the Skin's build.
 */
import { CD_ACTION, COMPOSANTS, type AnyComposant, type CdActionDetail } from '@crewdeck/sdk';
import type { LitElement } from 'lit';
import passerelle from '../index.js';
import { fillSlots } from '../slots.js';

/** What the core does at boot: each implementation under its canonical tag. */
export const defineSkin = (): void => {
  for (const [name, impl] of Object.entries(passerelle.composants)) {
    const declaration = COMPOSANTS[name as keyof typeof COMPOSANTS];
    if (impl && !customElements.get(declaration.tag)) customElements.define(declaration.tag, impl);
  }
};

/** Waits for `root` and every Composant rendered inside it, through their shadow roots. */
export const settle = async (root: Element): Promise<void> => {
  const pending = [root, ...root.querySelectorAll('*'), ...(root.shadowRoot?.querySelectorAll('*') ?? [])];
  for (const el of pending) {
    if (el.localName.startsWith('cd-')) {
      await (el as LitElement).updateComplete;
      if (el !== root) await settle(el);
    }
  }
};

/** `declaration`'s element with `data` and its Emplacements, appended to `parent`, rendered. */
export const render = async (
  declaration: AnyComposant,
  data: unknown,
  slots: Readonly<Record<string, string>> = {},
  parent: Element = document.body,
): Promise<LitElement & { data: unknown }> => {
  const el = document.createElement(declaration.tag) as LitElement & { data: unknown };
  el.data = data;
  el.append(...fillSlots(slots));
  parent.append(el);
  await settle(el);
  return el;
};

/** The element inside `host` at `selectors`, one per shadow root crossed. */
export const inside = <E extends Element = HTMLElement>(host: Element, ...selectors: string[]): E => {
  let node: Element = host;
  for (const selector of selectors) {
    const next = (node.shadowRoot ?? node).querySelector(selector);
    if (!next) throw new Error(`nothing at ${selectors.join(' >>> ')}`);
    node = next;
  }
  return node as E;
};

/** The focused element, through the shadow roots. */
export const deepActiveElement = (): Element | null => {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
};

/** The `cd-action`s reaching the document while `act` runs. */
export const actionsOf = async (act: () => unknown): Promise<CdActionDetail[]> => {
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

/** A node's text, its white space collapsed. */
export const textOf = (el: Node | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();
