import { ProcessCanvas, t, type CdActionDetail, type ComposantData } from '@crewdeck/sdk';
import { css, html, nothing, svg, type LitElement } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';
import { TYPE_SLUG } from './port.js';
import { measure, type Measured } from './process-canvas/layout.js';
import { route, toPath, type Box, type Point, type Routes } from './process-canvas/route.js';

type Data = ComposantData<typeof ProcessCanvas>;
type View = Pick<Data, 'zoom' | 'pan'>;
type Step = Data['phases'][number]['steps'][number];
type PortType = Step['ports'][number]['type'];

const ZOOM_MIN = 25;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;
/** How far a pointer moves before a press becomes a drag, in screen pixels. */
const DRAG_THRESHOLD = 4;
/** How far an arrow key pans, in the canvas's units; how long after the last wheel turn its gesture ends. */
const KEY_PAN = 40;
const WHEEL_END_MS = 250;
const ARROW_RADIUS = 12;
const LOOP_RADIUS = 14;
/** The order arrows are drawn in: an active one on top. */
const DRAW_ORDER = { gap: 1, refused: 2, active: 3 } as const;

type Drag =
  | { kind: 'pan'; x: number; y: number; pan: { x: number; y: number }; moved: boolean; background: boolean }
  | { kind: 'step'; stepId: string; x: number; y: number; moved: boolean; at: Point; size: { width: number; height: number }; offset: Point }
  | { kind: 'connect'; stepId: string; portId: string; type: PortType; from: Point; at: Point }
  | { kind: 'loopBack'; stepId: string; from: Point; at: Point };

const clampZoom = (zoom: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom)));

/**
 * `cd-process-canvas`: the Process on an infinite canvas (US-92). It renders,
 * in its own shadow tree, its Phases on their grid, their Étapes' cards with
 * their ports and Outils, one SVG layer under the cards with every arrow and
 * Retour (routed by `route.ts` from what `layout.ts` measures), a badge on
 * each Retour, and its zoom at its foot; `toast` over its top, `menu` on its
 * right edge.
 *
 * Its zoom and pan are data: it keeps its own while the Pilote moves, and
 * emits `view` at the end of each gesture. While `editable`, a card dropped on
 * a free cell emits `moveStep`, a Sortie dropped on an Entrée `connect`, the
 * Retour's handle dropped on a card `loopBack`; whether that is allowed is the
 * core's: the marks during a drag compare the ports' types only.
 */
export class PasserelleProcessCanvas extends PasserelleElement<typeof ProcessCanvas> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        position: relative;
        height: 100%;
        min-height: calc(var(--cd-step-card) * 3);
      }
      .canvas {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background-color: var(--cd-side);
        background-image: radial-gradient(var(--cd-line) thin, transparent thin);
        background-size: var(--cd-space-5) var(--cd-space-5);
        touch-action: none;
        cursor: grab;
      }
      .canvas:focus-visible {
        outline: var(--cd-stroke) solid var(--cd-accent);
        outline-offset: calc(var(--cd-stroke) * -1);
      }
      .panning {
        cursor: grabbing;
      }
      .content {
        position: relative;
        display: grid;
        gap: var(--cd-space-8);
        padding: var(--cd-space-6);
        width: max-content;
        align-items: start;
        transform-origin: 0 0;
      }
      .wires,
      .overlay {
        position: absolute;
        left: 0;
        top: 0;
        pointer-events: none;
        overflow: visible;
      }
      .overlay {
        z-index: 3;
      }
      cd-phase {
        justify-self: start;
      }
      cd-step-card {
        cursor: pointer;
      }
      .editable cd-step-card {
        cursor: grab;
      }
      .editable cd-port[data-dir='out'] {
        cursor: crosshair;
      }
      .wire {
        fill: none;
        stroke: var(--type, var(--cd-control-border));
        stroke-width: var(--cd-stroke);
        stroke-linecap: round;
      }
      .has-active .wire:not(.active):not(.loop):not(.refused) {
        opacity: 0.25;
      }
      .wire.gap,
      .wire.loop {
        stroke: var(--cd-caution);
        stroke-dasharray: var(--cd-space-1) var(--cd-space-1);
      }
      .wire.refused {
        stroke: var(--cd-halt);
        stroke-dasharray: var(--cd-space-2) var(--cd-space-1);
      }
      .wire.loop.active,
      .wire.provisional {
        stroke: var(--cd-accent);
      }
      cd-loop-back {
        position: absolute;
        z-index: 2;
      }
      .unrouted {
        visibility: hidden;
      }
      .cell {
        min-height: calc(var(--cd-step-card) / 2);
        align-self: stretch;
        border: var(--cd-stroke) dashed var(--cd-accent);
        border-radius: var(--cd-radius-lg);
        background: var(--cd-accent-soft);
        opacity: 0.6;
      }
      .ghost {
        position: absolute;
        z-index: 3;
        pointer-events: none;
        border: var(--cd-stroke) dashed var(--cd-accent);
        border-radius: var(--cd-radius-lg);
        background: var(--cd-accent-soft);
        opacity: 0.8;
      }
      .zoom {
        position: absolute;
        z-index: 3;
        left: var(--cd-space-4);
        bottom: var(--cd-space-4);
        display: flex;
        align-items: center;
        gap: var(--cd-space-1);
        padding: var(--cd-space-1);
        background: var(--cd-raised);
        border: thin solid var(--cd-line-strong);
        border-radius: var(--cd-radius-lg);
        cursor: auto;
      }
      .zoom cd-icon-button::part(button) {
        width: var(--cd-control-sm);
        height: var(--cd-control-sm);
      }
      .zoom output {
        min-width: var(--cd-space-10);
        text-align: center;
        color: var(--cd-ink-2);
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
      }
      .toast {
        position: absolute;
        z-index: 3;
        left: 50%;
        top: var(--cd-space-4);
        transform: translateX(-50%);
        width: max-content;
        max-width: var(--cd-dialog-width);
        cursor: auto;
      }
      .menu {
        position: absolute;
        z-index: 4;
        top: var(--cd-space-4);
        right: var(--cd-space-4);
        cursor: auto;
      }
    `,
  ];

  protected readonly composant = ProcessCanvas;

  /** The view shown: the data's, until the Pilote moves. */
  private view: View = { zoom: 100, pan: { x: 0, y: 0 } };
  private shownView: string | null = null;
  private measured: Measured | null = null;
  private routes: Routes | null = null;
  private drag: Drag | null = null;
  private wheelTimer: ReturnType<typeof setTimeout> | undefined;
  private layoutFrame = 0;
  private readonly resizes = new ResizeObserver(() => this.scheduleLayout());

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizes.disconnect();
    cancelAnimationFrame(this.layoutFrame);
    clearTimeout(this.wheelTimer);
    this.endDrag();
  }

  protected override willUpdate(): void {
    const key = JSON.stringify({ zoom: this.data.zoom, pan: this.data.pan });
    if (key !== this.shownView) {
      this.shownView = key;
      this.view = { zoom: this.data.zoom, pan: { ...this.data.pan } };
    }
  }

  protected override updated(changed: Map<PropertyKey, unknown>): void {
    if (!changed.has('data')) return;
    this.resizes.disconnect();
    const content = this.content;
    if (!content) return;
    this.resizes.observe(content);
    for (const el of content.querySelectorAll('cd-phase, cd-step-card')) this.resizes.observe(el);
    this.scheduleLayout();
  }

  private get content(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('.content');
  }

  private get viewport(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('.canvas');
  }

  /** Measures and routes once laid out, after every Composant inside has rendered. */
  private scheduleLayout(): void {
    cancelAnimationFrame(this.layoutFrame);
    this.layoutFrame = requestAnimationFrame(() => void this.layout());
  }

  private async layout(): Promise<void> {
    const content = this.content;
    if (!content) return;
    await Promise.all(
      [...content.querySelectorAll('*')].filter((el) => el.localName.startsWith('cd-')).map((el) => (el as LitElement).updateComplete),
    );
    const measured = measure(content, this.view.zoom / 100);
    const { loopBacks, arrows } = this.data;
    this.measured = measured;
    this.routes = route({
      ...measured,
      arrows,
      loopBacks: loopBacks.map((loop, i) => ({ from: loop.from, to: loop.to, badge: measured.badges[i] ?? { width: 0, height: 0 } })),
    });
    this.requestUpdate();
  }

  // The view ------------------------------------------------------------------

  private applyView(view: View): void {
    this.view = view;
    this.requestUpdate();
  }

  private emitView(): void {
    this.emit('view', { zoom: this.view.zoom, pan: { ...this.view.pan } });
  }

  /** Zooms to `zoom`, keeping the point at `at` (in the viewport, in pixels) where it is; the centre without one. */
  private zoomTo(zoom: number, at?: Point): void {
    const viewport = this.viewport;
    const z0 = this.view.zoom / 100;
    const z1 = clampZoom(zoom) / 100;
    const p = at ?? { x: (viewport?.clientWidth ?? 0) / 2, y: (viewport?.clientHeight ?? 0) / 2 };
    const pan = { x: this.view.pan.x + p.x / z0 - p.x / z1, y: this.view.pan.y + p.y / z0 - p.y / z1 };
    this.applyView({ zoom: clampZoom(zoom), pan });
  }

  private zoomBy(delta: number): void {
    this.zoomTo(this.view.zoom + delta);
    this.emitView();
  }

  /** « Tout voir »: every Phase in the viewport, centred. */
  private fit(): void {
    const viewport = this.viewport;
    const content = this.content;
    if (!viewport || !content) return;
    const width = content.offsetWidth;
    const height = content.offsetHeight;
    const zoom = Math.floor(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(viewport.clientWidth / width, viewport.clientHeight / height) * 100)));
    const z = zoom / 100;
    this.applyView({ zoom, pan: { x: (width - viewport.clientWidth / z) / 2, y: (height - viewport.clientHeight / z) / 2 } });
    this.emitView();
  }

  /** A point of the viewport, in pixels, in the canvas's units. */
  private toCanvas(clientX: number, clientY: number): Point {
    const rect = this.viewport?.getBoundingClientRect();
    const z = this.view.zoom / 100;
    return { x: this.view.pan.x + (clientX - (rect?.left ?? 0)) / z, y: this.view.pan.y + (clientY - (rect?.top ?? 0)) / z };
  }

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const rect = this.viewport?.getBoundingClientRect();
      const at = { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
      this.zoomTo(this.view.zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP), at);
    } else {
      const z = this.view.zoom / 100;
      this.applyView({ zoom: this.view.zoom, pan: { x: this.view.pan.x + event.deltaX / z, y: this.view.pan.y + event.deltaY / z } });
    }
    clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => this.emitView(), WHEEL_END_MS);
  };

  private readonly onKeydown = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    const pans: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    const pan = pans[event.key];
    if (event.key === '+' || event.key === '=') this.zoomBy(ZOOM_STEP);
    else if (event.key === '-') this.zoomBy(-ZOOM_STEP);
    else if (pan) {
      this.applyView({ zoom: this.view.zoom, pan: { x: this.view.pan.x + pan.x * KEY_PAN, y: this.view.pan.y + pan.y * KEY_PAN } });
      this.emitView();
    } else return;
    event.preventDefault();
  };

  // What the cards and the Phases inside emit becomes the canvas's own ----------

  private readonly onInnerAction = (event: Event) => {
    const detail = (event as CustomEvent<CdActionDetail>).detail;
    const target = event.target as HTMLElement;
    // What the Emplacements' Composants emit is theirs: only the cards' and the Phases' become the canvas's.
    if (!this.renderRoot.contains(target) || !['cd-step-card', 'cd-phase'].includes(target.localName)) return;
    event.stopPropagation();
    if (detail.composant === 'StepCard' && detail.action === 'select' && !this.suppressClick) {
      this.emit('select', { target: { kind: 'step', id: target.dataset['step'] ?? '' } });
    } else if (detail.composant === 'Phase' && detail.action === 'select') {
      this.emit('select', { target: { kind: 'phase', id: target.dataset['phase'] ?? '' } });
    } else if (detail.composant === 'StepCard' && detail.action === 'startLoopBack' && this.data.editable) {
      const card = this.measured?.cards.find((c) => c.id === target.dataset['step']);
      const from = card ? { x: (card.box.l + card.box.r) / 2, y: card.box.b } : this.centreOf(target);
      this.startDrag({ kind: 'loopBack', stepId: target.dataset['step'] ?? '', from, at: from });
    }
  };

  /** Set after a drag of a card so that its click does not select it. */
  private suppressClick = false;

  // Gestures --------------------------------------------------------------------

  private centreOf(el: Element): Point {
    const rect = el.getBoundingClientRect();
    return this.toCanvas((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const path = event.composedPath();
    const within = (selector: string) =>
      path.find((node): node is HTMLElement => node instanceof HTMLElement && node.matches(selector) && this.renderRoot.contains(node));
    if (within('.zoom, .toast, .menu')) return;
    const port = within('cd-port[data-dir="out"]');
    const card = within('cd-step-card');
    const { editable } = this.data;
    if (editable && port && card) {
      const step = this.stepOf(card.dataset['step']);
      const data = step?.ports.find((p) => p.dir === 'out' && p.id === port.dataset['port']);
      if (!step || !data) return;
      const rect = port.getBoundingClientRect();
      const box = card.getBoundingClientRect();
      const from = this.toCanvas(box.right, (rect.top + rect.bottom) / 2);
      event.preventDefault();
      this.startDrag({ kind: 'connect', stepId: step.id, portId: data.id, type: data.type, from, at: from });
      return;
    }
    if (card) {
      if (!editable) return;
      const box = card.getBoundingClientRect();
      const z = this.view.zoom / 100;
      const at = this.toCanvas(event.clientX, event.clientY);
      const corner = this.toCanvas(box.left, box.top);
      this.startDrag({
        kind: 'step',
        stepId: card.dataset['step'] ?? '',
        x: event.clientX,
        y: event.clientY,
        moved: false,
        at,
        size: { width: box.width / z, height: box.height / z },
        offset: { x: at.x - corner.x, y: at.y - corner.y },
      });
      return;
    }
    this.startDrag({ kind: 'pan', x: event.clientX, y: event.clientY, pan: { ...this.view.pan }, moved: false, background: !within('cd-phase') });
  };

  private startDrag(drag: Drag): void {
    this.drag = drag;
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
    this.requestUpdate();
  }

  private endDrag(): void {
    this.drag = null;
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    this.requestUpdate();
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag) return;
    if (drag.kind === 'pan') {
      const z = this.view.zoom / 100;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) drag.moved = true;
      if (drag.moved) this.applyView({ zoom: this.view.zoom, pan: { x: drag.pan.x - dx / z, y: drag.pan.y - dy / z } });
      return;
    }
    if (drag.kind === 'step' && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= DRAG_THRESHOLD) drag.moved = true;
    drag.at = this.toCanvas(event.clientX, event.clientY);
    this.requestUpdate();
  };

  private readonly onPointerCancel = () => this.endDrag();

  private readonly onPointerUp = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag) return;
    const under = (selector: string) =>
      this.renderRoot instanceof ShadowRoot
        ? this.renderRoot.elementsFromPoint(event.clientX, event.clientY).find((el): el is HTMLElement => el instanceof HTMLElement && el.matches(selector))
        : undefined;
    if (drag.kind === 'pan') {
      if (drag.moved) this.emitView();
      else if (drag.background) this.emit('select', { target: null });
    } else if (drag.kind === 'step' && drag.moved) {
      const cell = under('.cell');
      this.suppressClick = true;
      setTimeout(() => (this.suppressClick = false));
      if (cell) {
        this.emit('moveStep', {
          stepId: drag.stepId,
          phaseId: cell.dataset['phase'] ?? '',
          col: Number(cell.dataset['col']),
          row: Number(cell.dataset['row']),
        });
      }
    } else if (drag.kind === 'connect') {
      const port = under('cd-port[data-dir="in"]');
      const card = port?.closest<HTMLElement>('cd-step-card');
      if (port && card) {
        this.emit('connect', {
          from: { stepId: drag.stepId, portId: drag.portId },
          to: { stepId: card.dataset['step'] ?? '', portId: port.dataset['port'] ?? '' },
        });
      }
    } else if (drag.kind === 'loopBack') {
      const card = under('cd-step-card');
      const to = card?.dataset['step'];
      if (to && to !== drag.stepId) this.emit('loopBack', { from: drag.stepId, to });
    }
    this.endDrag();
  };

  private stepOf(id: string | undefined): Step | undefined {
    return this.data.phases.flatMap((phase) => phase.steps).find((step) => step.id === id);
  }

  // Rendering ---------------------------------------------------------------------

  private portState(step: Step, port: Step['ports'][number]): Step['ports'][number]['state'] {
    const drag = this.drag;
    if (drag?.kind !== 'connect') return port.state;
    if (port.dir === 'out') return drag.stepId === step.id && drag.portId === port.id ? 'active' : port.state;
    return port.type === drag.type ? 'compatible' : 'refused';
  }

  /** The cells a dragged card may drop on: each Phase's empty cells, one more column and one more row included. */
  private freeCells(phase: Data['phases'][number]) {
    const drag = this.drag;
    if (drag?.kind !== 'step' || !drag.moved) return nothing;
    const taken = new Set(phase.steps.map((s) => `${s.col},${s.row}`));
    const cols = Math.max(0, ...phase.steps.map((s) => s.col)) + 1;
    const rows = Math.max(0, ...phase.steps.map((s) => s.row)) + 1;
    const cells = [];
    for (let row = 1; row <= rows; row++) {
      for (let col = 1; col <= cols; col++) {
        if (!taken.has(`${col},${row}`)) cells.push({ col, row });
      }
    }
    return cells.map(
      ({ col, row }) =>
        html`<div class="cell" style="grid-column: ${col}; grid-row: ${row}" data-phase=${phase.id} data-col=${col} data-row=${row}></div>`,
    );
  }

  private renderStep(step: Step) {
    const { col, row, ports, tools, ...card } = step;
    const ordered = [...ports.filter((p) => p.dir === 'in'), ...ports.filter((p) => p.dir === 'out')];
    return html`<cd-step-card style="grid-column: ${col}; grid-row: ${row}" data-step=${step.id} .data=${card}>
      ${ordered.map(
        (port) =>
          html`<cd-port slot="ports" data-port=${port.id} data-dir=${port.dir} .data=${{ ...port, state: this.portState(step, port) }}></cd-port>`,
      )}
      ${tools.map((tool) => html`<cd-tool-chip slot="tools" .data=${tool}></cd-tool-chip>`)}
    </cd-step-card>`;
  }

  private renderWires() {
    const size = this.measured?.size ?? { width: 0, height: 0 };
    const routes = this.routes;
    const { arrows, loopBacks } = this.data;
    const typeOf = (stepId: string, portId: string) => this.stepOf(stepId)?.ports.find((p) => p.dir === 'out' && p.id === portId)?.type;
    const order = arrows
      .map((arrow, i) => ({ arrow, points: routes?.arrows[i] }))
      .filter((a): a is { arrow: (typeof arrows)[number]; points: readonly Point[] } => !!a.points)
      .sort((a, b) => (a.arrow.state ? DRAW_ORDER[a.arrow.state] : 0) - (b.arrow.state ? DRAW_ORDER[b.arrow.state] : 0));
    return html`<svg class="wires" width=${size.width} height=${size.height} aria-hidden="true">
      ${order.map(({ arrow, points }) => {
        const type = typeOf(arrow.from.stepId, arrow.from.portId);
        return svg`<path class="wire arrow ${arrow.state ?? ''}" data-from=${`${arrow.from.stepId}.${arrow.from.portId}`}
          data-to=${`${arrow.to.stepId}.${arrow.to.portId}`} style=${type ? `--type: var(--cd-type-${TYPE_SLUG[type]})` : ''}
          d=${toPath(points, ARROW_RADIUS)}></path>`;
      })}
      ${loopBacks.map((loop, i) => {
        const routed = routes?.loopBacks[i];
        return routed ? svg`<path class="wire loop ${loop.state ?? ''}" d=${toPath(routed.points, LOOP_RADIUS)}></path>` : nothing;
      })}
    </svg>`;
  }

  private renderOverlay() {
    const drag = this.drag;
    if (!drag || drag.kind === 'pan') return nothing;
    if (drag.kind === 'step') {
      if (!drag.moved) return nothing;
      const { x, y } = { x: drag.at.x - drag.offset.x, y: drag.at.y - drag.offset.y };
      return html`<div class="ghost" style="left: ${x}px; top: ${y}px; width: ${drag.size.width}px; height: ${drag.size.height}px"></div>`;
    }
    const { from, at } = drag;
    const d =
      drag.kind === 'connect'
        ? `M${from.x},${from.y} C${(from.x + at.x) / 2},${from.y} ${(from.x + at.x) / 2},${at.y} ${at.x},${at.y}`
        : `M${from.x},${from.y} C${from.x},${Math.max(from.y, at.y) + 40} ${at.x},${Math.max(from.y, at.y) + 40} ${at.x},${at.y}`;
    return html`<svg class="overlay" width="1" height="1" aria-hidden="true">
      ${svg`<path class="wire provisional ${drag.kind === 'loopBack' ? 'loop' : ''}" d=${d}></path>`}
    </svg>`;
  }

  private renderBadge(loop: Data['loopBacks'][number], i: number) {
    const badge: Box | undefined = this.routes?.loopBacks[i]?.badge;
    const style = badge ? `left: ${badge.l}px; top: ${badge.t}px` : 'left: 0; top: 0';
    return html`<cd-loop-back class=${badge ? '' : 'unrouted'} data-loop=${i} style=${style} .data=${{ max: loop.max, state: loop.state }}></cd-loop-back>`;
  }

  protected override render() {
    const { editable, phases, arrows, loopBacks } = this.data;
    const { zoom, pan } = this.view;
    const z = zoom / 100;
    const classes = ['canvas', editable ? 'editable' : '', arrows.some((a) => a.state === 'active') ? 'has-active' : '', this.drag?.kind === 'pan' && this.drag.moved ? 'panning' : ''];
    return html`<div
      class=${classes.join(' ')}
      part="canvas"
      role="group"
      aria-label=${t('canvas.label')}
      tabindex="0"
      @pointerdown=${this.onPointerDown}
      @wheel=${this.onWheel}
      @keydown=${this.onKeydown}
      @cd-action=${this.onInnerAction}
    >
      <div class="content" style="transform: translate(${-pan.x * z}px, ${-pan.y * z}px) scale(${z})">
        ${this.renderWires()}
        ${phases.map((phase) => {
          const { col, row, steps, ...data } = phase;
          return html`<cd-phase style="grid-column: ${col}; grid-row: ${row}" data-phase=${phase.id} .data=${data}>
            ${steps.map((step) => this.renderStep(step))} ${this.freeCells(phase)}
          </cd-phase>`;
        })}
        ${loopBacks.map((loop, i) => this.renderBadge(loop, i))} ${this.renderOverlay()}
      </div>
      <div class="toast"><slot name="toast"></slot></div>
      <div class="menu"><slot name="menu"></slot></div>
      <div class="zoom" part="zoom" role="group" aria-label=${t('canvas.zoom')}>
        <cd-icon-button class="zoom-out" .data=${{ icon: 'minus', label: t('canvas.zoomOut') }} @click=${() => this.zoomBy(-ZOOM_STEP)}></cd-icon-button>
        <output aria-live="polite">${t('canvas.zoomValue', { zoom })}</output>
        <cd-icon-button class="zoom-in" .data=${{ icon: 'plus', label: t('canvas.zoomIn') }} @click=${() => this.zoomBy(ZOOM_STEP)}></cd-icon-button>
        <cd-button class="fit" .data=${{ label: t('canvas.fit'), variant: 'ghost', size: 'sm', icon: 'fit' }} @click=${() => this.fit()}></cd-button>
      </div>
    </div>`;
  }
}
