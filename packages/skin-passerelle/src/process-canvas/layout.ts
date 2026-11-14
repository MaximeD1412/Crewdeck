import type { Box, CardGeometry, Scene } from './route.js';

/**
 * What the canvas hands its router: the boxes of its `cd-step-card`s and
 * `cd-phase`s, its `cd-port`s' heights and its badges' sizes, all read in its
 * own shadow tree (never inside another Composant's shadow root), in the
 * canvas's units: relative to its content, the zoom taken out.
 *
 * A card carries `data-step`, a port `data-port` and `data-dir`, a Phase
 * `data-phase`, a badge `data-loop` (its index in the Retours).
 */
export type Measured = Omit<Scene, 'arrows' | 'loopBacks'> & {
  readonly badges: readonly { readonly width: number; readonly height: number }[];
  readonly size: { readonly width: number; readonly height: number };
};

export const measure = (content: HTMLElement, zoom: number): Measured => {
  const origin = content.getBoundingClientRect();
  const boxOf = (el: Element): Box => {
    const rect = el.getBoundingClientRect();
    return {
      l: (rect.left - origin.left) / zoom,
      t: (rect.top - origin.top) / zoom,
      r: (rect.right - origin.left) / zoom,
      b: (rect.bottom - origin.top) / zoom,
    };
  };
  const middle = (el: Element) => {
    const { t, b } = boxOf(el);
    return (t + b) / 2;
  };

  const cards: CardGeometry[] = [...content.querySelectorAll<HTMLElement>('cd-step-card[data-step]')].map((card) => {
    const ports = [...card.querySelectorAll<HTMLElement>(':scope > cd-port[data-port]')];
    const anchors = (dir: string) =>
      Object.fromEntries(ports.filter((port) => port.dataset['dir'] === dir).map((port) => [port.dataset['port'], middle(port)]));
    return { id: card.dataset['step'] ?? '', box: boxOf(card), inputs: anchors('in'), outputs: anchors('out') };
  });

  // A Phase's head is what lies above its cards, inside its padding: the gap between the two is a lane.
  const gap = parseFloat(getComputedStyle(content).getPropertyValue('--cd-space-4')) * parseFloat(getComputedStyle(document.documentElement).fontSize);
  const phases: Box[] = [];
  const heads: Box[] = [];
  for (const phase of content.querySelectorAll<HTMLElement>('cd-phase[data-phase]')) {
    const box = boxOf(phase);
    phases.push(box);
    const inner = [...phase.querySelectorAll(':scope > cd-step-card')].map(boxOf);
    if (inner.length === 0) continue;
    const inset = Math.min(...inner.map((card) => card.l)) - box.l;
    heads.push({ l: box.l + inset, t: box.t, r: box.r - inset, b: Math.min(...inner.map((card) => card.t)) - (Number.isFinite(gap) ? gap : 16) });
  }

  const badges = [...content.querySelectorAll<HTMLElement>('cd-loop-back[data-loop]')].map((badge) => ({
    width: badge.offsetWidth,
    height: badge.offsetHeight,
  }));

  return { cards, phases, heads, badges, size: { width: content.offsetWidth, height: content.offsetHeight } };
};
