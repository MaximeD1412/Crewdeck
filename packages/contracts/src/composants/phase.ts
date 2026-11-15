import { z } from 'zod';
import { defineComposant } from './define.js';
import { portHtml, toolChipHtml } from './step-card.js';

const json = (data: unknown) => JSON.stringify(data).replace(/'/g, '&#39;');
const card = (col: number, data: unknown, ports: unknown[], tools: unknown[]) =>
  `<cd-step-card style="grid-column: ${col}; grid-row: 1" data='${json(data)}'>${ports.map((port) => portHtml(port).replace('<cd-port', '<cd-port slot="ports"')).join('')}${tools.map((tool) => toolChipHtml(tool).replace('<cd-tool-chip', '<cd-tool-chip slot="tools"')).join('')}</cd-step-card>`;

/**
 * A Phase on the canvas: its name, « pour <forEach> » with the accent rail
 * when it repeats, its Manques' count, then the grid of its Étapes (the
 * default Emplacement, each card in its cell). `target` marks where an added
 * Étape goes; a click on its head emits `select`.
 */
export const Phase = defineComposant({
  name: 'Phase',
  version: 1,
  tag: 'cd-phase',
  category: 'partie',
  description: 'Une Phase du Process : son nom, ce qu’elle répète, ses Manques, et la grille de ses Étapes.',
  data: z.object({
    id: z.string().min(1),
    name: z.string(),
    forEach: z.string().nullable(),
    gaps: z.int().min(0),
    target: z.boolean(),
    selected: z.boolean(),
  }),
  actions: { select: z.object({}) },
  slots: ['default'],
  examples: [
    {
      name: 'une Phase',
      data: { id: 'idee', name: 'Idée', forEach: null, gaps: 0, target: false, selected: false },
      slots: {
        default: [
          card(
            1,
            { id: 'analyse', name: 'Analyse de l’Idée', kindLabel: 'Agent', variant: 'agent', selected: false, gaps: 0, judges: false },
            [
              { id: 'idee', dir: 'in', type: 'idea', label: 'Idée', note: 'notée par toi', state: null },
              { id: 'idee', dir: 'out', type: 'idea', label: 'Idée', note: null, state: null },
            ],
            [
              { kind: 'role', label: 'Idée' },
              { kind: 'skill', label: 'analyse-idee' },
            ],
          ),
          card(
            2,
            { id: 'tri', name: 'Tri de l’Idée', kindLabel: 'Pilote', variant: 'gate', selected: false, gaps: 0, judges: true },
            [
              { id: 'idee', dir: 'in', type: 'idea', label: 'Idée', note: null, state: null },
              { id: 'idee', dir: 'out', type: 'idea', label: 'Idée', note: 'retenue', state: null },
            ],
            [],
          ),
        ].join(''),
      },
    },
    {
      name: 'répétée pour chaque Ticket, la cible',
      data: { id: 'developpement', name: 'Développement', forEach: 'chaque Ticket prêt', gaps: 0, target: true, selected: false },
      slots: {
        default: card(
          1,
          { id: 'code', name: 'Code', kindLabel: 'Agent', variant: 'agent', selected: false, gaps: 0, judges: false },
          [
            { id: 'ticket', dir: 'in', type: 'ticket', label: 'Ticket', note: null, state: null },
            { id: 'changement', dir: 'out', type: 'code-change', label: 'Changement de code', note: null, state: null },
          ],
          [
            { kind: 'role', label: 'Code' },
            { kind: 'skill', label: 'red-green' },
          ],
        ),
      },
    },
    {
      name: 'avec un Manque',
      data: { id: 'idee', name: 'Idée', forEach: null, gaps: 1, target: false, selected: true },
      slots: {
        default: card(
          1,
          { id: 'inventaire', name: 'Inventaire', kindLabel: 'Agent', variant: 'agent', selected: false, gaps: 1, judges: false },
          [
            { id: 'inventaire', dir: 'in', type: 'inventory', label: 'Inventaire', note: null, state: 'unfed' },
            { id: 'inventaire', dir: 'out', type: 'inventory', label: 'Inventaire', note: null, state: null },
          ],
          [{ kind: 'role', label: 'Conception' }],
        ),
      },
    },
  ],
});
