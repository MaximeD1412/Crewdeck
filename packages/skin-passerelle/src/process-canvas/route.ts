/**
 * The canvas's router (ADR 0011, no graph library): from the boxes of the
 * cards, of the Phases and of their heads, and the ports' anchors, the path
 * of each arrow and each Retour. Pure geometry, in the canvas's own units;
 * whether an arrow is allowed is the core's.
 *
 * - Retours first, below the cards they pass under, each branch around the
 *   cards below its own through a gutter; their badge then is an obstacle.
 * - Each arrow leaves its Sortie to the right and enters its Entrée from the
 *   left, orthogonal, through the gutters beside and between the cards, with
 *   one or two detours; never across a card, a Phase's head or a badge.
 * - The cheapest free path wins (its length, its bends, the lanes it shares),
 *   short arrows first: they take the lanes next to their cards; a Sortie's
 *   arrows together, at the rank of its shortest.
 * - Arrows from different Sorties never share a lane (more lanes are tried
 *   before giving in); those of one Sortie share their trunk. A Phase's
 *   border is never a lane.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A box by its edges: left, top, right, bottom. */
export interface Box {
  readonly l: number;
  readonly t: number;
  readonly r: number;
  readonly b: number;
}

/** A card and the height of each of its ports' centres: Entrées and Sorties apart, as they may share an id. */
export interface CardGeometry {
  readonly id: string;
  readonly box: Box;
  readonly inputs: Readonly<Record<string, number>>;
  readonly outputs: Readonly<Record<string, number>>;
}

export interface PortEnd {
  readonly stepId: string;
  readonly portId: string;
}

export interface Scene {
  readonly cards: readonly CardGeometry[];
  /** The Phases' boxes: their borders are no lane. */
  readonly phases: readonly Box[];
  /** The Phases' heads: no arrow crosses them. */
  readonly heads: readonly Box[];
  readonly arrows: readonly { readonly from: PortEnd; readonly to: PortEnd }[];
  /** Each Retour, from the Étape that judges to the one it sends back to, and its badge's size. */
  readonly loopBacks: readonly { readonly from: string; readonly to: string; readonly badge: { readonly width: number; readonly height: number } }[];
}

export interface Routes {
  /** Each arrow's points, in `scene.arrows`' order; null when one of its ports is not on the canvas. */
  readonly arrows: readonly (readonly Point[] | null)[];
  /** Each Retour's points and its badge's box, in `scene.loopBacks`' order; null when one of its Étapes is not there. */
  readonly loopBacks: readonly ({ readonly points: readonly Point[]; readonly badge: Box } | null)[];
}

/** The distances of `design/components.js` `draw`, in the canvas's units. */
const CARD_MARGIN = 2;
const HEAD_MARGIN = 2;
const BADGE_MARGIN = 3;
/** How far below the cards it passes under a Retour runs, and how much its badge rises above its curve. */
const LOOP_DROP = 28;
const BADGE_LIFT = 4;
/** The gutters: beside a card, below or above it, and the lanes around each. */
const V_GUTTER = 10;
const H_GUTTER = 14;
const V_LANES = [0, -3, 3, -6, 6];
const H_LANES = [0, -4, 4, -8, 8];
/** How close two parallel segments run along one lane, and along the lanes beside it (they cost, they are allowed). */
const SAME_LANE = 2;
const NEAR_LANE = 4;
/** What a path costs beyond its length: a bend, a lane taken twice, a crossing. */
const BEND_COST = 24;
const ALONG_COST = 400;
const ALONG_FACTOR = 4;
const CROSS_COST = 6;
/** How many lanes near each end a two-detour path tries, then how many when none of those is clear. */
const NEAR_LANES = 6;
const WIDER_LANES = 18;
/** How many times a Retour's depth is reckoned again once its branches leave their column. */
const LOOP_PASSES = 3;

interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}
interface Routed extends Segment {
  /** The Sortie it comes from, `phase` for a Phase's border. */
  readonly src: string;
}
interface Obstacle extends Box {
  readonly card?: string;
}

const grow = (box: Box, by: number): Box => ({ l: box.l - by, t: box.t - by, r: box.r + by, b: box.b + by });
const centreX = (box: Box) => (box.l + box.r) / 2;
const segments = (points: readonly Point[]): Segment[] =>
  points.slice(1).map((point, i) => ({ x1: points[i]!.x, y1: points[i]!.y, x2: point.x, y2: point.y }));
const isVertical = (s: Segment) => Math.abs(s.x1 - s.x2) < 0.5;
/** The length two intervals share. */
const overlap = (a1: number, a2: number, b1: number, b2: number) =>
  Math.max(0, Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2)));
const crosses = (s: Segment, o: Box) =>
  Math.max(s.x1, s.x2) > o.l && Math.min(s.x1, s.x2) < o.r && Math.max(s.y1, s.y2) > o.t && Math.min(s.y1, s.y2) < o.b;
const unique = (values: number[]) => [...new Set(values.map(Math.round))];

export const route = (scene: Scene): Routes => {
  const cards = new Map(scene.cards.map((card) => [card.id, card]));
  const obstacles: Obstacle[] = [
    ...scene.cards.map((card) => ({ ...grow(card.box, CARD_MARGIN), card: card.id })),
    ...scene.heads.map((head) => grow(head, HEAD_MARGIN)),
  ];

  const xs = unique(scene.cards.flatMap(({ box }) => [box.r + V_GUTTER, box.l - V_GUTTER]).flatMap((x) => V_LANES.map((o) => x + o)));
  const ys = unique(scene.cards.flatMap(({ box }) => [box.b + H_GUTTER, box.t - H_GUTTER]).flatMap((y) => H_LANES.map((o) => y + o)));

  // The first segment leaves card A, the last one enters card B: those two do not count there.
  const free = (points: readonly Point[], a: string | null, b: string | null) =>
    segments(points).every((s, i, all) => {
      const skip = [i === 0 ? a : null, i === all.length - 1 ? b : null];
      return obstacles.every((o) => (o.card !== undefined && skip.includes(o.card)) || !crosses(s, o));
    });

  /**
   * A Retour's branch, from the bottom of its card down to its depth: straight when nothing is in its way,
   * else into the gap below its card, before the first card or badge it meets, along it to the nearest free
   * lane, then down. When no such path is free, the one that crosses the least.
   */
  const branch = (box: Box, id: string, low: number): Point[] => {
    const start = { x: centreX(box), y: box.b };
    const straight = [start, { x: start.x, y: low }];
    if (free(straight, id, null)) return straight;
    const down = { x1: start.x, y1: box.b, x2: start.x, y2: low };
    const top = Math.min(...obstacles.filter((o) => o.card !== id && crosses(down, o)).map((o) => o.t));
    const floor = box.b + CARD_MARGIN;
    const jogs = unique([(floor + top) / 2, ...ys.filter((y) => y > floor && y < top)]).sort((u, v) => u - v);
    const lanes = [...xs].sort((u, v) => Math.abs(u - start.x) - Math.abs(v - start.x));
    const paths = jogs.flatMap((y) => lanes.map((x) => [start, { x: start.x, y }, { x, y }, { x, y: low }]));
    const clear = paths.find((points) => free(points, id, null));
    if (clear) return clear;
    // A card crossed weighs more than a badge.
    const hits = (points: readonly Point[]) =>
      segments(points).reduce(
        (sum, s, i) => sum + obstacles.filter((o) => !(i === 0 && o.card === id) && crosses(s, o)).reduce((n, o) => n + (o.card ? 10 : 1), 0),
        0,
      );
    return [straight, ...paths].reduce((best, points) => (hits(points) < hits(best) ? points : best));
  };

  // Retours first: their badges are obstacles for the arrows.
  const loopBacks = scene.loopBacks.map((loop) => {
    const from = cards.get(loop.from)?.box;
    const to = cards.get(loop.to)?.box;
    if (!from || !to) return null;
    // Below every card between its two ends, along the width its branches reach.
    let span = [centreX(from), centreX(to)];
    let low = 0;
    let out: Point[] = [];
    let back: Point[] = [];
    for (let pass = 0; pass < LOOP_PASSES; pass++) {
      const under = scene.cards
        .map((card) => card.box)
        .filter((b) => b.r > Math.min(...span) && b.l < Math.max(...span) && b.t < Math.max(from.b, to.b) && b.b > Math.min(from.t, to.t) - 1);
      const deeper = Math.max(from.b, to.b, ...under.map((b) => b.b)) + LOOP_DROP;
      if (deeper === low) break;
      low = deeper;
      out = branch(from, loop.from, low);
      back = branch(to, loop.to, low);
      span = [...span, out.at(-1)!.x, back.at(-1)!.x];
    }
    const x1 = out.at(-1)!.x;
    const x2 = back.at(-1)!.x;
    const cx = (x1 + x2) / 2;
    const badge = { l: cx - loop.badge.width / 2, t: low - BADGE_LIFT, r: cx + loop.badge.width / 2, b: low - BADGE_LIFT + loop.badge.height };
    obstacles.push(grow(badge, BADGE_MARGIN));
    return { points: [...out, ...back.reverse()], badge };
  });

  const routed: Routed[] = scene.phases.flatMap((b) =>
    [
      { x1: b.l, y1: b.t, x2: b.r, y2: b.t },
      { x1: b.l, y1: b.b, x2: b.r, y2: b.b },
      { x1: b.l, y1: b.t, x2: b.l, y2: b.b },
      { x1: b.r, y1: b.t, x2: b.r, y2: b.b },
    ].map((s) => ({ ...s, src: 'phase' })),
  );

  /** A path's cost, and whether it runs along another Sortie's lane or a Phase's border. */
  const cost = (points: readonly Point[], src: string) => {
    let total = BEND_COST * (points.length - 2);
    let shares = false;
    for (const s of segments(points)) {
      total += Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
      const vertical = isVertical(s);
      for (const o of routed) {
        if (o.src === src) continue;
        const otherVertical = isVertical(o);
        const apart = vertical && otherVertical ? Math.abs(o.x1 - s.x1) : !vertical && !otherVertical ? Math.abs(o.y1 - s.y1) : Infinity;
        if (apart < NEAR_LANE) {
          const along = vertical ? overlap(s.y1, s.y2, o.y1, o.y2) : overlap(s.x1, s.x2, o.x1, o.x2);
          if (along > 0) {
            total += ALONG_COST + ALONG_FACTOR * along;
            if (apart < SAME_LANE) shares = true;
          }
        } else if (vertical !== otherVertical) {
          const [v, h] = vertical ? [s, o] : [o, s];
          const crossing =
            v.x1 > Math.min(h.x1, h.x2) && v.x1 < Math.max(h.x1, h.x2) && h.y1 > Math.min(v.y1, v.y2) && h.y1 < Math.max(v.y1, v.y2);
          if (crossing && o.src !== 'phase') total += CROSS_COST;
        }
      }
    }
    return { total, shares };
  };

  /** The first bend of each Sortie's arrows, once one is routed: the others share it. */
  const trunks = new Map<string, number>();

  const candidates = (p1: Point, p2: Point, trunk: number | undefined, nearLanes: number): Point[][] => {
    const found: Point[][] = [];
    if (Math.abs(p1.y - p2.y) < 1 && p2.x > p1.x) found.push([p1, p2]);
    for (const x of xs) if (x > p1.x + 4 && x < p2.x - 4) found.push([p1, { x, y: p1.y }, { x, y: p2.y }, p2]);
    const near = (ok: (x: number) => boolean, distance: (x: number) => number) =>
      xs
        .filter(ok)
        .sort((u, v) => distance(u) - distance(v))
        .slice(0, nearLanes);
    const starts = near((x) => x > p1.x + 4, (x) => x - p1.x);
    if (trunk !== undefined && !starts.includes(trunk)) starts.push(trunk);
    const ends = near((x) => x < p2.x - 4, (x) => p2.x - x);
    for (const xa of starts) {
      for (const xb of ends) {
        for (const y of ys) {
          found.push([p1, { x: xa, y: p1.y }, { x: xa, y }, { x: xb, y }, { x: xb, y: p2.y }, p2]);
        }
      }
    }
    if (trunk === undefined) return found;
    const shared = found.filter((points) => points.length === 2 || points[1]!.x === trunk);
    return shared.length > 0 ? [...shared, ...found] : found;
  };

  const routeOne = (p1: Point, p2: Point, a: string, b: string, src: string): Point[] => {
    const trunk = trunks.get(src);
    // The cheapest path on a lane of its own; failing one, the cheapest at all.
    let clear: Point[] | null = null;
    let clearCost = Infinity;
    let best: Point[] | null = null;
    let bestCost = Infinity;
    for (const nearLanes of [NEAR_LANES, WIDER_LANES]) {
      const all = candidates(p1, p2, trunk, nearLanes);
      // The trunk's paths come first: any of them clear wins over the others.
      const sharedCount = trunk === undefined ? 0 : all.findIndex((points) => points.length !== 2 && points[1]!.x !== trunk);
      for (const [i, points] of all.entries()) {
        if (clear && trunk !== undefined && i === sharedCount && sharedCount > 0) break;
        if (!free(points, a, b)) continue;
        const { total, shares } = cost(points, src);
        if (!shares && total < clearCost) {
          clear = points;
          clearCost = total;
        }
        if (total < bestCost) {
          best = points;
          bestCost = total;
        }
      }
      if (clear) break;
    }
    const mid = (p1.x + p2.x) / 2;
    const chosen = clear ?? best ?? [p1, { x: mid, y: p1.y }, { x: mid, y: p2.y }, p2];
    if (chosen.length > 2 && !trunks.has(src)) trunks.set(src, chosen[1]!.x);
    for (const s of segments(chosen)) routed.push({ ...s, src });
    return chosen;
  };

  const ends = scene.arrows.map((arrow) => {
    const from = cards.get(arrow.from.stepId);
    const to = cards.get(arrow.to.stepId);
    const y1 = from?.outputs[arrow.from.portId];
    const y2 = to?.inputs[arrow.to.portId];
    if (!from || !to || y1 === undefined || y2 === undefined) return null;
    const p1 = { x: from.box.r, y: y1 };
    const p2 = { x: to.box.l, y: y2 };
    return { p1, p2, a: from.id, b: to.id, src: `${arrow.from.stepId}.${arrow.from.portId}`, length: Math.abs(p2.x - p1.x) + Math.abs(p2.y - p1.y) };
  });
  const paths: (Point[] | null)[] = ends.map(() => null);
  // Short arrows first: they take the lanes next to their cards, the long ones go around. A Sortie's arrows go
  // together, at the rank of its shortest: its trunk is then whole before another Sortie looks for a lane beside it.
  const routable = ends.flatMap((end, i) => (end ? [{ end, i }] : []));
  const shortest = new Map<string, number>();
  for (const { end } of routable) shortest.set(end.src, Math.min(shortest.get(end.src) ?? Infinity, end.length));
  const order = routable.sort(
    (u, v) => shortest.get(u.end.src)! - shortest.get(v.end.src)! || u.end.src.localeCompare(v.end.src) || u.end.length - v.end.length,
  );
  for (const { end, i } of order) paths[i] = routeOne(end.p1, end.p2, end.a, end.b, end.src);

  return { arrows: paths, loopBacks };
};

/** A polyline's SVG path with rounded corners, the radius shrinking in a narrow gutter. */
export const toPath = (points: readonly Point[], radius: number): string => {
  const q = points.filter((p, i) => i === 0 || Math.abs(p.x - points[i - 1]!.x) + Math.abs(p.y - points[i - 1]!.y) > 0.5);
  const first = q[0];
  const last = q[q.length - 1];
  if (!first || !last) return '';
  const n = (value: number) => Math.round(value * 100) / 100;
  let d = `M${n(first.x)},${n(first.y)}`;
  for (let i = 1; i < q.length - 1; i++) {
    const p0 = q[i - 1]!;
    const p = q[i]!;
    const p1 = q[i + 1]!;
    const l0 = Math.hypot(p.x - p0.x, p.y - p0.y);
    const l1 = Math.hypot(p1.x - p.x, p1.y - p.y);
    const r = Math.min(radius, i === 1 ? l0 : l0 / 2, i === q.length - 2 ? l1 : l1 / 2);
    const a0 = { x: p.x - ((p.x - p0.x) / l0) * r, y: p.y - ((p.y - p0.y) / l0) * r };
    const a1 = { x: p.x + ((p1.x - p.x) / l1) * r, y: p.y + ((p1.y - p.y) / l1) * r };
    d += ` L${n(a0.x)},${n(a0.y)} Q${n(p.x)},${n(p.y)} ${n(a1.x)},${n(a1.y)}`;
  }
  return `${d} L${n(last.x)},${n(last.y)}`;
};
