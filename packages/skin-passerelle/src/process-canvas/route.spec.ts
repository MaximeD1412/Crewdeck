import { readFileSync } from 'node:fs';
import { COMPOSANTS } from '@crewdeck/sdk';
import type { Measured } from './layout.js';
import { route, toPath, type Box, type Point, type Scene } from './route.js';

/**
 * « le Process Crewdeck » as the canvas measures it at 100 % in Chromium
 * (`layout.ts`, written once from the browser): three Phases, 17 Étapes, 25
 * arrows and 4 Retours, as `design/screens/gestion-du-process/process.html`.
 */
const measured = JSON.parse(readFileSync(new URL('./process-crewdeck.measured.json', import.meta.url), 'utf8')) as Measured;
const example = COMPOSANTS.ProcessCanvas.data.parse(COMPOSANTS.ProcessCanvas.examples[0]?.data);
const scene: Scene = {
  ...measured,
  arrows: example.arrows,
  loopBacks: example.loopBacks.map((loop, i) => ({ from: loop.from, to: loop.to, badge: measured.badges[i] ?? { width: 0, height: 0 } })),
};
const routes = route(scene);
const arrows = scene.arrows.map((arrow, i) => ({ ...arrow, src: `${arrow.from.stepId}.${arrow.from.portId}`, points: routes.arrows[i] ?? [] }));
const cardOf = (id: string) => scene.cards.find((card) => card.id === id)!;

interface Segment {
  readonly a: Point;
  readonly b: Point;
}
const segmentsOf = (points: readonly Point[]): Segment[] => points.slice(1).map((b, i) => ({ a: points[i]!, b }));
const horizontal = (s: Segment) => s.a.y === s.b.y;
/** Whether a segment enters a box's interior, its edges excluded. */
const enters = (s: Segment, box: Box) =>
  Math.max(s.a.x, s.b.x) > box.l && Math.min(s.a.x, s.b.x) < box.r && Math.max(s.a.y, s.b.y) > box.t && Math.min(s.a.y, s.b.y) < box.b;
/** How long two parallel segments run within `within` of each other. */
const alongside = (s: Segment, o: Segment, within: number) => {
  if (horizontal(s) !== horizontal(o)) return 0;
  const [across, lo, hi, oAcross, oLo, oHi] = horizontal(s)
    ? [s.a.y, Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x), o.a.y, Math.min(o.a.x, o.b.x), Math.max(o.a.x, o.b.x)]
    : [s.a.x, Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y), o.a.x, Math.min(o.a.y, o.b.y), Math.max(o.a.y, o.b.y)];
  return Math.abs(across - oAcross) < within ? Math.max(0, Math.min(hi, oHi) - Math.max(lo, oLo)) : 0;
};
const borders = (box: Box): Segment[] => [
  { a: { x: box.l, y: box.t }, b: { x: box.r, y: box.t } },
  { a: { x: box.l, y: box.b }, b: { x: box.r, y: box.b } },
  { a: { x: box.l, y: box.t }, b: { x: box.l, y: box.b } },
  { a: { x: box.r, y: box.t }, b: { x: box.r, y: box.b } },
];

type RoutedArrow = { readonly src: string; readonly to: { readonly stepId: string }; readonly points: readonly Point[] };
/** Each pair of arrows from two Sorties running along one lane, within 2 units. */
const sharedLanes = (all: readonly RoutedArrow[]) => {
  const shared: string[] = [];
  for (const [i, arrow] of all.entries()) {
    for (const other of all.slice(i + 1)) {
      if (other.src === arrow.src) continue;
      for (const s of segmentsOf(arrow.points)) {
        for (const o of segmentsOf(other.points)) {
          if (alongside(s, o, 2) > 0) shared.push(`${arrow.src} → ${arrow.to.stepId} and ${other.src} → ${other.to.stepId}`);
        }
      }
    }
  }
  return shared;
};
/** The cards a path enters, its ends on their edges excluded. */
const cardsCrossed = (points: readonly Point[], cards: Scene['cards']) =>
  segmentsOf(points).flatMap((s) => cards.filter(({ box }) => enters(s, box)).map(({ id }) => id));

describe('route, on « le Process Crewdeck »', () => {
  it('routes every arrow and every Retour', () => {
    expect(scene.cards).toHaveLength(17);
    expect(arrows).toHaveLength(25);
    expect(routes.arrows.every((points) => points !== null)).toBe(true);
    expect(routes.loopBacks).toHaveLength(4);
    expect(routes.loopBacks.every((loop) => loop !== null)).toBe(true);
  });

  it.each(arrows.map((arrow) => [`${arrow.src} → ${arrow.to.stepId}.${arrow.to.portId}`, arrow] as const))(
    '%s leaves its Sortie to the right and enters its Entrée from the left, orthogonal',
    (_name, { from, to, points }) => {
      const source = cardOf(from.stepId);
      const target = cardOf(to.stepId);
      const [first, second] = points;
      const [last, beforeLast] = [...points].reverse();
      expect(first).toEqual({ x: source.box.r, y: source.outputs[from.portId] });
      expect(second?.y).toBe(first?.y);
      expect(second!.x).toBeGreaterThan(first!.x);
      expect(last).toEqual({ x: target.box.l, y: target.inputs[to.portId] });
      expect(beforeLast?.y).toBe(last?.y);
      expect(beforeLast!.x).toBeLessThan(last!.x);
      for (const s of segmentsOf(points)) expect(s.a.x === s.b.x || s.a.y === s.b.y).toBe(true);
    },
  );

  it('crosses no card, no Phase’s head and no Retour’s badge', () => {
    const obstacles = [
      ...scene.cards.map((card) => ({ name: `the card ${card.id}`, box: card.box })),
      ...scene.heads.map((box, i) => ({ name: `the head of Phase ${i + 1}`, box })),
      ...routes.loopBacks.map((loop, i) => ({ name: `the badge of Retour ${i + 1}`, box: loop!.badge })),
    ];
    const crossings = arrows.flatMap((arrow) =>
      segmentsOf(arrow.points).flatMap((s) => obstacles.filter((o) => enters(s, o.box)).map((o) => `${arrow.src} → ${arrow.to.stepId}: ${o.name}`)),
    );
    expect(crossings).toEqual([]);
  });

  it('gives the arrows of one Sortie one trunk: their first segment', () => {
    const bySource = Map.groupBy(arrows, (arrow) => arrow.src);
    const shared = [...bySource.values()].filter((group) => group.length > 1);
    expect(shared.length).toBeGreaterThan(0);
    for (const group of shared) {
      const firsts = group.map(({ points }) => points.slice(0, 2));
      // A straight arrow's first segment is all of it: the others' trunk runs along it.
      const bends = firsts.filter((_, i) => group[i]!.points.length > 2).map(([, bend]) => bend);
      expect(new Set(bends.map((bend) => `${bend?.x},${bend?.y}`)).size).toBeLessThanOrEqual(1);
    }
  });

  it('never runs arrows from two Sorties along one lane', () => {
    expect(sharedLanes(arrows)).toEqual([]);
  });

  it('never takes a Phase’s border as a lane', () => {
    const along = arrows.flatMap((arrow) =>
      segmentsOf(arrow.points).flatMap((s) =>
        scene.phases.flatMap((phase, p) => borders(phase).filter((border) => alongside(s, border, 2) > 0).map(() => `${arrow.src}: Phase ${p + 1}`)),
      ),
    );
    expect(along).toEqual([]);
  });

  it('runs each Retour below the cards it passes under, its badge on its curve, clear of every card', () => {
    for (const [i, loop] of scene.loopBacks.entries()) {
      const { points, badge } = routes.loopBacks[i]!;
      const from = cardOf(loop.from).box;
      const to = cardOf(loop.to).box;
      expect(points[0]).toEqual({ x: (from.l + from.r) / 2, y: from.b });
      expect(points.at(-1)).toEqual({ x: (to.l + to.r) / 2, y: to.b });
      for (const s of segmentsOf(points)) expect(s.a.x === s.b.x || s.a.y === s.b.y).toBe(true);
      const low = Math.max(...points.map((p) => p.y));
      const bottom = segmentsOf(points).find((s) => horizontal(s) && s.a.y === low)!;
      const under = scene.cards.filter(
        ({ box }) => box.r > Math.min(bottom.a.x, bottom.b.x) && box.l < Math.max(bottom.a.x, bottom.b.x) && box.t < Math.max(from.b, to.b) && box.b > Math.min(from.t, to.t),
      );
      for (const { box } of under) expect(low).toBeGreaterThan(box.b);
      expect(badge.t).toBeLessThan(low);
      expect(badge.b).toBeGreaterThan(low);
      expect(badge.l).toBeGreaterThanOrEqual(Math.min(bottom.a.x, bottom.b.x));
      expect(badge.r).toBeLessThanOrEqual(Math.max(bottom.a.x, bottom.b.x));
      expect(scene.cards.filter(({ box }) => enters({ a: { x: badge.l, y: badge.t }, b: { x: badge.r, y: badge.t } }, box))).toEqual([]);
      expect(cardsCrossed(points, scene.cards)).toEqual([]);
    }
  });
});

describe('route', () => {
  const card = (id: string, l: number, t: number) => ({ id, box: { l, t, r: l + 100, b: t + 80 }, inputs: { a: t + 40 }, outputs: { a: t + 40 } });

  it('draws two cards side by side, their ports level, with one straight arrow', () => {
    const { arrows } = route({
      cards: [card('x', 0, 0), card('y', 200, 0)],
      phases: [],
      heads: [],
      arrows: [{ from: { stepId: 'x', portId: 'a' }, to: { stepId: 'y', portId: 'a' } }],
      loopBacks: [],
    });
    expect(arrows[0]).toEqual([
      { x: 100, y: 40 },
      { x: 200, y: 40 },
    ]);
  });

  it('goes around a card in its way', () => {
    const { arrows } = route({
      cards: [card('x', 0, 0), card('block', 150, 0), card('y', 300, 0)],
      phases: [],
      heads: [],
      arrows: [{ from: { stepId: 'x', portId: 'a' }, to: { stepId: 'y', portId: 'a' } }],
      loopBacks: [],
    });
    const points = arrows[0]!;
    expect(points.length).toBeGreaterThan(2);
    for (const s of segmentsOf(points)) expect(enters(s, { l: 150, t: 0, r: 250, b: 80 })).toBe(false);
  });

  /** Cards of 176 × 150 on a grid of 196 × 190 from (20, 60), their Entrée 50 below their top, their Sortie 100. */
  const cell = (id: string, col: number, row: number) => {
    const l = 20 + (col - 1) * 196;
    const t = 60 + (row - 1) * 190;
    return { id, box: { l, t, r: l + 176, b: t + 150 }, inputs: { a: t + 50 }, outputs: { a: t + 100 } };
  };
  const arrow = (from: string, to: string) => ({ from: { stepId: from, portId: 'a' }, to: { stepId: to, portId: 'a' } });

  it('finds another lane rather than run beside another Sortie’s arrow', () => {
    const cards = [cell('c1', 4, 4), cell('c2', 4, 3), cell('c3', 2, 3), cell('c6', 5, 1), cell('c7', 2, 1), cell('c8', 5, 3)];
    const scene: Scene = { cards, phases: [], heads: [], arrows: [arrow('c1', 'c6'), arrow('c2', 'c7'), arrow('c3', 'c8')], loopBacks: [] };
    const routed = route(scene).arrows.map((points, i) => ({ src: `${scene.arrows[i]!.from.stepId}.a`, to: scene.arrows[i]!.to, points: points! }));
    expect(sharedLanes(routed)).toEqual([]);
    for (const { points } of routed) expect(cardsCrossed(points, cards)).toEqual([]);
  });

  it('takes a Retour around the cards below the one it goes back to', () => {
    const cards = [
      { id: 'A', box: { l: 20, t: 60, r: 196, b: 210 }, inputs: { a: 110 }, outputs: { a: 160 } },
      { id: 'B', box: { l: 20, t: 250, r: 196, b: 400 }, inputs: { a: 300 }, outputs: { a: 350 } },
      { id: 'C', box: { l: 216, t: 250, r: 392, b: 400 }, inputs: { a: 300 }, outputs: { a: 350 } },
    ];
    const { loopBacks } = route({ cards, phases: [], heads: [], arrows: [arrow('A', 'B'), arrow('B', 'C')], loopBacks: [{ from: 'C', to: 'A', badge: { width: 150, height: 18 } }] });
    const { points, badge } = loopBacks[0]!;
    expect(points[0]).toEqual({ x: 304, y: 400 });
    expect(points.at(-1)).toEqual({ x: 108, y: 210 });
    expect(cardsCrossed(points, cards)).toEqual([]);
    for (const s of segmentsOf(points)) expect(s.a.x === s.b.x || s.a.y === s.b.y).toBe(true);
    expect(cards.filter(({ box }) => enters({ a: { x: badge.l, y: badge.t }, b: { x: badge.r, y: badge.b } }, box))).toEqual([]);
  });

  it('takes a Retour around another Retour’s badge as around a card', () => {
    const box = (l: number, t: number) => ({ l, t, r: l + 176, b: t + 150 });
    const cards = [
      { id: 'A', box: box(20, 60), inputs: { a: 110 }, outputs: { a: 160 } },
      { id: 'C', box: box(412, 60), inputs: { a: 110 }, outputs: { a: 160 } },
      { id: 'E', box: box(804, 60), inputs: { a: 110 }, outputs: { a: 160 } },
      { id: 'D', box: box(412, 440), inputs: { a: 490 }, outputs: { a: 540 } },
    ];
    const badge = { width: 159, height: 18 };
    const { loopBacks } = route({
      cards,
      phases: [],
      heads: [],
      arrows: [arrow('A', 'E'), arrow('C', 'D')],
      loopBacks: [
        { from: 'E', to: 'A', badge },
        { from: 'D', to: 'C', badge },
      ],
    });
    const [first, second] = loopBacks as { points: Point[]; badge: Box }[];
    expect(second!.points[0]).toEqual({ x: 500, y: 590 });
    expect(second!.points.at(-1)).toEqual({ x: 500, y: 210 });
    for (const { points } of [first!, second!]) {
      expect(cardsCrossed(points, cards)).toEqual([]);
      for (const s of segmentsOf(points)) expect(s.a.x === s.b.x || s.a.y === s.b.y).toBe(true);
    }
    expect(segmentsOf(second!.points).filter((s) => enters(s, first!.badge))).toEqual([]);
  });

  it('routes nothing for a port that is not on the canvas', () => {
    const { arrows, loopBacks } = route({
      cards: [card('x', 0, 0)],
      phases: [],
      heads: [],
      arrows: [{ from: { stepId: 'x', portId: 'a' }, to: { stepId: 'gone', portId: 'a' } }],
      loopBacks: [{ from: 'x', to: 'gone', badge: { width: 10, height: 10 } }],
    });
    expect(arrows).toEqual([null]);
    expect(loopBacks).toEqual([null]);
  });
});

describe('toPath', () => {
  it('rounds each corner, by less in a narrow gutter', () => {
    expect(toPath([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }], 12)).toBe('M0,0 L38,0 Q50,0 50,12 L50,50');
    expect(toPath([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 6 }, { x: 100, y: 6 }], 12)).toBe('M0,0 L47,0 Q50,0 50,3 L50,3 Q50,6 53,6 L100,6');
  });
});
