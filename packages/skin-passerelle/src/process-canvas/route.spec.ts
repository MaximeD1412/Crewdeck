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
    const shared: string[] = [];
    for (const [i, arrow] of arrows.entries()) {
      for (const other of arrows.slice(i + 1)) {
        if (other.src === arrow.src) continue;
        for (const s of segmentsOf(arrow.points)) {
          for (const o of segmentsOf(other.points)) {
            if (alongside(s, o, 2) > 0) shared.push(`${arrow.src} → ${arrow.to.stepId} and ${other.src} → ${other.to.stepId}`);
          }
        }
      }
    }
    expect(shared).toEqual([]);
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
      const routed = routes.loopBacks[i]!;
      const from = cardOf(loop.from).box;
      const to = cardOf(loop.to).box;
      const low = routed.points[1]!.y;
      expect(routed.points[0]).toEqual({ x: (from.l + from.r) / 2, y: from.b });
      expect(routed.points[3]).toEqual({ x: (to.l + to.r) / 2, y: to.b });
      const under = scene.cards.filter(({ box }) => box.r > Math.min(routed.points[0]!.x, routed.points[3]!.x) && box.l < Math.max(routed.points[0]!.x, routed.points[3]!.x) && box.t < Math.max(from.b, to.b) && box.b > Math.min(from.t, to.t));
      for (const { box } of under) expect(low).toBeGreaterThan(box.b);
      expect(routed.badge.t).toBeLessThan(low);
      expect(routed.badge.b).toBeGreaterThan(low);
      expect(scene.cards.filter(({ box }) => enters({ a: { x: routed.badge.l, y: routed.badge.t }, b: { x: routed.badge.r, y: routed.badge.t } }, box))).toEqual([]);
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
