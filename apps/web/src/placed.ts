/**
 * A Composant the core places into another's Emplacement: its tag, its
 * Emplacement (`slot`, none for the default one), its data, then either the
 * text of its default Emplacement or the Composants placed in its own.
 */
export interface PlacedNode {
  readonly tag: `cd-${string}`;
  readonly slot?: string;
  /** Its `id`, for the core to find what it placed (a button whose click it handles). */
  readonly id?: string;
  readonly data?: unknown;
  readonly text?: string;
  readonly children?: readonly PlacedNode[];
}

type WithData = Element & { data?: unknown };

/**
 * Makes the children of `host` the `nodes`, in their order: an element of the
 * same tag and Emplacement is kept from one call to the next (its state, its
 * focus), given its new data; the others are created or removed.
 */
export const fillPlaced = (host: Element, nodes: readonly PlacedNode[]): void => {
  const free = [...host.children];
  const elements = nodes.map((node) => {
    const index = free.findIndex((child) => child.localName === node.tag && (child.getAttribute('slot') ?? undefined) === node.slot);
    const element = (index >= 0 ? free.splice(index, 1)[0] : document.createElement(node.tag)) as WithData;
    if (node.slot === undefined) element.removeAttribute('slot');
    else element.slot = node.slot;
    if (node.id !== undefined) element.id = node.id;
    if (node.data !== undefined) element.data = node.data;
    if (node.text !== undefined) {
      if (element.textContent !== node.text) element.textContent = node.text;
    } else fillPlaced(element, node.children ?? []);
    return element;
  });
  for (const child of free) child.remove();
  elements.forEach((element, index) => {
    if (host.children[index] !== element) host.insertBefore(element, host.children[index] ?? null);
  });
};
