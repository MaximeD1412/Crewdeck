/**
 * A Composant the core places into another's Emplacement: its tag, its
 * Emplacement (`slot`, none for the default one), its data, then the text of
 * its default Emplacement, the Composants placed in its own, or both (an
 * Empty's text and its button): the text first.
 */
export interface PlacedNode {
  readonly tag: `cd-${string}`;
  readonly slot?: string;
  readonly data?: unknown;
  readonly text?: string;
  readonly children?: readonly PlacedNode[];
}

import { sameData } from './same-data.js';

type WithData = Element & { data?: unknown };

/** The text before the element's children: its first node, kept, its other text nodes removed. */
const leadingText = (element: Element, text: string) => {
  const first = element.firstChild;
  const kept = first?.nodeType === Node.TEXT_NODE ? (first as Text) : element.insertBefore(document.createTextNode(''), first);
  for (const node of [...element.childNodes]) if (node !== kept && node.nodeType === Node.TEXT_NODE) node.remove();
  if (kept.data !== text) kept.data = text;
};

/**
 * Gives `element` the node's data when its values changed (what was typed
 * stays), then its text and its own children (`fillPlaced`). Its tag and
 * Emplacement are the caller's.
 */
export const placeNode = (element: Element, node: PlacedNode): void => {
  const target = element as WithData;
  if (node.data !== undefined && !sameData(target.data, node.data)) target.data = node.data;
  if (node.text !== undefined && node.children === undefined) {
    if (element.textContent !== node.text) element.textContent = node.text;
  } else {
    if (node.text !== undefined) leadingText(element, node.text);
    fillPlaced(element, node.children ?? []);
  }
};

/**
 * Makes the children of `host` the `nodes`, in their order: an element of the
 * same tag and Emplacement is kept from one call to the next (its state, its
 * focus), given its new data when its values changed (what was typed stays);
 * the others are created or removed.
 */
export const fillPlaced = (host: Element, nodes: readonly PlacedNode[]): void => {
  const free = [...host.children];
  const elements = nodes.map((node) => {
    const index = free.findIndex((child) => child.localName === node.tag && (child.getAttribute('slot') ?? undefined) === node.slot);
    const element = index >= 0 ? (free.splice(index, 1)[0] as Element) : document.createElement(node.tag);
    if (node.slot === undefined) element.removeAttribute('slot');
    else element.slot = node.slot;
    placeNode(element, node);
    return element;
  });
  for (const child of free) child.remove();
  elements.forEach((element, index) => {
    if (host.children[index] !== element) host.insertBefore(element, host.children[index] ?? null);
  });
};
