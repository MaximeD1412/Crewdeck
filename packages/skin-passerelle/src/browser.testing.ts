/// <reference types="vite/client" />
/**
 * What the Skin's browser specs share: the elements defined as the core does
 * at boot, the tokens and the ground loaded, and helpers to render a Composant,
 * reach inside its shadow roots and collect its `cd-action`s. Not built.
 */
// What the core loads before the Skin (apps/web/src/main.ts): the tokens and the document's ground.
import './tokens.css';
import './document.css';
import { CD_ACTION, COMPOSANTS, type AnyComposant, type CdActionDetail } from '@crewdeck/sdk';
import type { LitElement } from 'lit';
import passerelle from './index.js';
import { fillSlots } from './slots.js';

/** What the core does at boot: each implementation under its canonical tag. */
export const defineAll = (): void => {
  for (const [name, impl] of Object.entries(passerelle.composants)) {
    const declaration = COMPOSANTS[name as keyof typeof COMPOSANTS];
    if (impl && !customElements.get(declaration.tag)) customElements.define(declaration.tag, impl);
  }
};

export const render = async (declaration: AnyComposant, data: unknown, slots: Record<string, string> = {}) => {
  const el = document.createElement(declaration.tag) as LitElement & { data: unknown };
  el.data = data;
  el.append(...fillSlots(slots));
  document.body.append(el);
  await settle(el);
  return el;
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

export const textOf = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

