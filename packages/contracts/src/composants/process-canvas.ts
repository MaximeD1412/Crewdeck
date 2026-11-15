import { z } from 'zod';
import { ARTIFACT_TYPE_LABELS } from '../process/artifact-types.js';
import { defineComposant } from './define.js';
import { Phase } from './phase.js';
import { Port } from './port.js';
import { type PortType } from './process-canvas-types.js';
import { StepCard } from './step-card.js';
import { ToolChip } from './tool-chip.js';

export * from './process-canvas-types.js';

/** One end of an arrow: a port of an Étape. */
const zPortRef = z.object({ stepId: z.string().min(1), portId: z.string().min(1) });
const zCell = z.int().min(1).max(50);

const zCanvasStep = StepCard.data.extend({
  col: zCell,
  row: zCell,
  ports: z.array(Port.data),
  tools: z.array(ToolChip.data),
});
const zCanvasPhase = Phase.data.extend({ col: zCell, row: zCell, steps: z.array(zCanvasStep) });
const zArrow = z.object({ from: zPortRef, to: zPortRef, state: z.enum(['active', 'gap', 'refused']).nullable() });
/** What the canvas shows of the view: its zoom in percent, and the offset of its top left corner, in the canvas's units. */
const zView = z.object({ zoom: z.int().min(25).max(200), pan: z.object({ x: z.number(), y: z.number() }) });

type CanvasStep = z.input<typeof zCanvasStep>;
type CanvasPhase = z.input<typeof zCanvasPhase>;
type PortData = z.input<typeof Port.data>;
type ToolData = z.input<typeof ToolChip.data>;
type Arrow = z.input<typeof zArrow>;

// The examples' builders: « Process Crewdeck » as `design/screens/gestion-du-process/process.html` draws it.
const port =
  (dir: 'in' | 'out') =>
  (type: PortType, id: string = type, note: string | null = null): PortData => ({ id, dir, type, label: ARTIFACT_TYPE_LABELS[type], note, state: null });
const input = port('in');
const output = port('out');
const role = (label: string): ToolData => ({ kind: 'role', label });
const skill = (label: string): ToolData => ({ kind: 'skill', label });
const github: ToolData = { kind: 'connector', label: 'GitHub' };
const KIND_LABEL = { agent: 'Agent', gate: 'Pilote', command: 'Commande', core: 'Crewdeck' } as const;

const step = (
  id: string,
  name: string,
  variant: CanvasStep['variant'],
  [col, row]: [number, number],
  ports: PortData[],
  tools: ToolData[] = [],
  more: Partial<CanvasStep> = {},
): CanvasStep => ({ id, name, kindLabel: KIND_LABEL[variant], variant, col, row, selected: false, gaps: 0, judges: false, ports, tools, ...more });

const phase = (id: string, name: string, [col, row]: [number, number], steps: CanvasStep[], more: Partial<CanvasPhase> = {}): CanvasPhase => ({
  id,
  name,
  forEach: null,
  gaps: 0,
  col,
  row,
  target: false,
  selected: false,
  steps,
  ...more,
});

const judges = { judges: true } as const;

const ideaPhase = phase('ph-idee', 'Idée', [1, 1], [
  step('analyse', 'Analyse de l’Idée', 'agent', [1, 1], [input('idea', 'idee', 'notée par toi'), output('idea', 'idee')], [role('Idée'), skill('analyse-idee')]),
  step('tri', 'Tri de l’Idée', 'gate', [2, 1], [input('idea', 'idee'), output('idea', 'idee', 'retenue')], [], judges),
]);

const designPhase = phase('ph-conception', 'Conception', [1, 2], [
  step('prd', 'PRD', 'agent', [1, 1], [input('idea', 'idee'), output('prd')], [role('Conception'), skill('product-design')]),
  step('rc-prd', 'Revue croisée du PRD', 'agent', [2, 1], [input('prd'), output('verdict')], [role('Review'), skill('cross-review')], {
    kindLabel: 'Revue croisée',
    ...judges,
  }),
  step('ap-prd', 'Approbation du PRD', 'gate', [3, 1], [input('prd'), input('verdict'), output('prd')], [], judges),
  step('maq', 'Maquettes', 'agent', [4, 1], [input('prd'), output('mockups', 'maquettes')], [role('Conception'), skill('visual-design')]),
  step('ap-maq', 'Revue des maquettes', 'gate', [5, 1], [input('mockups', 'maquettes'), output('mockups', 'maquettes')], [], judges),
  step(
    'ct',
    'Conception technique',
    'agent',
    [1, 2],
    [input('prd'), input('mockups', 'maquettes'), output('technical-design', 'conception')],
    [role('Conception'), skill('technical-design')],
  ),
  step(
    'rc-ct',
    'Revue croisée de la conception',
    'agent',
    [2, 2],
    [input('technical-design', 'conception'), output('verdict')],
    [role('Review'), skill('cross-review')],
    { kindLabel: 'Revue croisée', ...judges },
  ),
  step(
    'ap-ct',
    'Approbation de la conception',
    'gate',
    [3, 2],
    [input('technical-design', 'conception'), input('verdict'), output('technical-design', 'conception')],
    [],
    judges,
  ),
  step(
    'tickets',
    'Découpage en Tickets',
    'agent',
    [4, 2],
    [input('prd'), input('mockups', 'maquettes'), input('technical-design', 'conception'), output('ticket')],
    [role('Conception'), skill('plan-backlog')],
  ),
  step('ap-tickets', 'Validation des Tickets', 'gate', [5, 2], [input('ticket'), output('ticket', 'ticket', 'prêt')], [], judges),
]);

const devSteps = [
  step('code', 'Code', 'agent', [1, 1], [input('ticket'), output('code-change', 'changement')], [role('Code'), skill('red-green')]),
  step('checks', 'Checks', 'core', [2, 1], [input('code-change', 'changement'), output('verdict')], [github], { kindLabel: 'CI du dépôt' }),
  step(
    'review',
    'Review',
    'agent',
    [3, 1],
    [input('code-change', 'changement'), input('verdict', 'verdict', 'des checks'), output('verdict')],
    [role('Review'), skill('review')],
    judges,
  ),
  step('rv', 'Revue visuelle', 'gate', [3, 2], [input('code-change', 'changement'), input('mockups', 'maquettes'), output('verdict')], [], judges),
  step(
    'fusion',
    'Merge',
    'core',
    [4, 1],
    [
      input('code-change', 'changement'),
      input('verdict', 'v-review', 'de la Review'),
      input('verdict', 'v-rv', 'de la Revue visuelle'),
      output('code-change', 'changement', 'mergé'),
    ],
    [github],
    { kindLabel: 'par la Boucle' },
  ),
];
const devPhase = phase('ph-dev', 'Développement', [1, 3], devSteps, { forEach: 'chaque Ticket prêt' });

/** `from` and `to` as `<stepId>.<portId>`. */
const arrow = (from: string, to: string, state: Arrow['state'] = null): Arrow => {
  const [fromStep = '', fromPort = ''] = from.split('.');
  const [toStep = '', toPort = ''] = to.split('.');
  return { from: { stepId: fromStep, portId: fromPort }, to: { stepId: toStep, portId: toPort }, state };
};

const ARROWS = [
  arrow('analyse.idee', 'tri.idee'),
  arrow('tri.idee', 'prd.idee'),
  arrow('prd.prd', 'rc-prd.prd'),
  arrow('prd.prd', 'ap-prd.prd'),
  arrow('rc-prd.verdict', 'ap-prd.verdict'),
  arrow('ap-prd.prd', 'maq.prd'),
  arrow('maq.maquettes', 'ap-maq.maquettes'),
  arrow('ap-prd.prd', 'ct.prd'),
  arrow('ap-maq.maquettes', 'ct.maquettes'),
  arrow('ct.conception', 'rc-ct.conception'),
  arrow('ct.conception', 'ap-ct.conception'),
  arrow('rc-ct.verdict', 'ap-ct.verdict'),
  arrow('ap-prd.prd', 'tickets.prd'),
  arrow('ap-maq.maquettes', 'tickets.maquettes'),
  arrow('ap-ct.conception', 'tickets.conception'),
  arrow('tickets.ticket', 'ap-tickets.ticket'),
  arrow('ap-tickets.ticket', 'code.ticket'),
  arrow('code.changement', 'checks.changement'),
  arrow('code.changement', 'review.changement'),
  arrow('checks.verdict', 'review.verdict'),
  arrow('code.changement', 'rv.changement'),
  arrow('ap-maq.maquettes', 'rv.maquettes'),
  arrow('code.changement', 'fusion.changement'),
  arrow('review.verdict', 'fusion.v-review'),
  arrow('rv.verdict', 'fusion.v-rv'),
];

const LOOP_BACKS = [
  { from: 'rc-prd', to: 'prd', max: 3, state: null },
  { from: 'rc-ct', to: 'ct', max: 3, state: null },
  { from: 'review', to: 'code', max: 3, state: null },
  { from: 'rv', to: 'code', max: 3, state: null },
] as const;

const crewdeck = {
  editable: true,
  zoom: 90,
  pan: { x: 0, y: 0 },
  phases: [ideaPhase, designPhase, devPhase],
  arrows: ARROWS,
  loopBacks: [...LOOP_BACKS],
};

// A Manque: an Étape added to the Phase Idée whose Entrée nothing feeds.
const withGap = {
  ...crewdeck,
  phases: [
    {
      ...ideaPhase,
      gaps: 1,
      steps: [
        ...ideaPhase.steps,
        step('inventaire', 'Inventaire', 'agent', [3, 1], [{ ...input('inventory', 'inventaire'), state: 'unfed' }, output('inventory', 'inventaire')], [role('Conception'), skill('inventory')], {
          gaps: 1,
        }),
      ],
    },
    designPhase,
    devPhase,
  ],
};

// The Sortie of « Code » dragged onto an Entrée of another type.
const mark = (ports: PortData[], dragged: PortType, refusedId: string | null): PortData[] =>
  ports.map((p) => (p.dir === 'in' ? { ...p, state: p.type === dragged ? 'compatible' : p.id === refusedId ? 'refused' : null } : p));
const refused = {
  ...crewdeck,
  phases: [
    ideaPhase,
    designPhase,
    {
      ...devPhase,
      steps: devSteps.map((s) => ({
        ...s,
        ports:
          s.id === 'code'
            ? s.ports.map((p) => (p.dir === 'out' ? { ...p, state: 'active' as const } : p))
            : mark(s.ports, 'code-change', s.id === 'rv' ? 'maquettes' : null),
      })),
    },
  ],
  arrows: [...ARROWS, arrow('code.changement', 'rv.maquettes', 'refused')],
};

// A Local Projet: the checks are Commandes, and a Phase Livraison runs one after the merge.
const local = {
  ...crewdeck,
  editable: false,
  zoom: 75,
  phases: [
    ideaPhase,
    designPhase,
    {
      ...devPhase,
      steps: devSteps.map((s) =>
        s.id === 'checks'
          ? { ...s, kindLabel: 'Commandes', tools: [{ kind: 'command', label: 'pnpm test' } as const, { kind: 'command', label: 'pnpm lint' } as const] }
          : s,
      ),
    },
    phase('ph-livraison', 'Livraison', [2, 3], [
      step(
        'lancer',
        'Lancer',
        'command',
        [1, 1],
        [
          { ...input('code-change', 'changement', 'mergé'), state: 'active' },
          { ...output('delivery', 'livraison'), state: 'active' },
        ],
        [{ kind: 'command', label: 'docker compose up -d' }],
        { selected: true },
      ),
    ]),
  ],
  arrows: [...ARROWS.map((a) => (a.from.stepId === 'code' && a.to.stepId === 'fusion' ? { ...a, state: 'active' as const } : a)), arrow('fusion.changement', 'lancer.changement', 'active')],
};

/**
 * « Gestion du process » (US-92): the Phases on their grid, each holding its
 * Étapes on its own, joined by arrows from a Sortie to an Entrée and by
 * Retours, routed in the gutters; the zoom at its foot, a `toast` over its
 * top, a `menu` on its right edge. It takes the whole graph as data and
 * computes geometry only: whether a move, an arrow or a Retour is allowed is
 * the core's. `view` follows each zoom or pan gesture; `moveStep`, `connect`
 * and `loopBack` are emitted only while `editable`.
 */
export const ProcessCanvas = defineComposant({
  name: 'ProcessCanvas',
  version: 1,
  tag: 'cd-process-canvas',
  category: 'partie',
  description: 'Le canevas du Process : les Phases, leurs Étapes, les flèches et les Retours, et son zoom.',
  data: zView.extend({
    editable: z.boolean(),
    phases: z.array(zCanvasPhase),
    arrows: z.array(zArrow),
    loopBacks: z.array(
      z.object({ from: z.string().min(1), to: z.string().min(1), max: z.int().min(1).max(10), state: z.enum(['active']).nullable() }),
    ),
  }),
  actions: {
    select: z.object({ target: z.object({ kind: z.enum(['step', 'phase']), id: z.string().min(1) }).nullable() }),
    view: zView,
    moveStep: z.object({ stepId: z.string().min(1), phaseId: z.string().min(1), col: zCell, row: zCell }),
    connect: z.object({ from: zPortRef, to: zPortRef }),
    loopBack: z.object({ from: z.string().min(1), to: z.string().min(1) }),
  },
  slots: ['toast', 'menu'],
  examples: [
    { name: 'le Process Crewdeck', data: crewdeck },
    { name: 'avec un Manque', data: withGap },
    {
      name: 'une flèche refusée',
      data: refused,
      slots: { toast: `<cd-toast data='{"tone":"halt","icon":"block","text":"Refusée : cette Entrée attend des Maquettes, pas un Changement de code."}'></cd-toast>` },
    },
    { name: 'un Projet Local, en lecture', data: local },
  ],
});
