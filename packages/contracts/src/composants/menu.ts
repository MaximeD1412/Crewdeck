import { z } from 'zod';
import { defineComposant } from './define.js';
import { zIconName } from './icons.js';

const zMenuEntry = z.object({
  id: z.string(),
  label: z.string(),
  icon: zIconName.nullable(),
  detail: z.string().nullable(),
  selected: z.boolean(),
  disabled: z.boolean(),
});

/**
 * A menu (WAI-ARIA `menu`): its groups and their items are arrays of its data
 * (no item Composant, `MenuItem` being the Cadre's entry). The focus goes to
 * its first enabled item when it is rendered; the arrows, Home and End move
 * it across the groups, Enter or Space chooses. `choose` with the item's id,
 * never for a disabled one; `close` on Escape or a pointer down outside it.
 * It does not place itself: the Composant that opens it does (the canvas's
 * `menu` Emplacement, under the « Étape » button). The catalogue of Étapes
 * (PROCESS-8), « Attacher un Outil » (PROCESS-9).
 */
export const Menu = defineComposant({
  name: 'Menu',
  version: 1,
  tag: 'cd-menu',
  category: 'partie',
  description: 'Un menu : ses groupes et leurs éléments, qu’on parcourt aux flèches et qu’on choisit à Entrée ; Échap le ferme.',
  data: z.object({
    title: z.string().nullable(),
    groups: z.array(z.object({ label: z.string(), items: z.array(zMenuEntry).min(1) })).min(1),
  }),
  actions: { choose: z.object({ id: z.string() }), close: z.object({}) },
  slots: [],
  examples: [
    {
      name: 'le catalogue des Étapes',
      data: {
        title: 'Ajouter dans « Développement »',
        groups: [
          {
            label: 'Étapes du Modèle de process « Process Crewdeck »',
            items: [
              { id: 'code', label: 'Code', icon: 'spark', detail: 'Ticket → Changement de code', selected: false, disabled: false },
              { id: 'review', label: 'Review', icon: 'spark', detail: 'sur le Rôle de ton choix → Verdict', selected: false, disabled: false },
              { id: 'checks', label: 'Checks', icon: 'check', detail: 'la CI du dépôt ou des Commandes → Verdict', selected: false, disabled: false },
            ],
          },
          {
            label: 'Sur ton Runner',
            items: [
              { id: 'command', label: 'Commande', icon: 'terminal', detail: 'jugée sur son code de sortie', selected: false, disabled: false },
            ],
          },
        ],
      },
    },
    {
      name: 'attacher un Outil',
      data: {
        title: 'Attacher à « Review »',
        groups: [
          {
            label: 'Rôle (un seul)',
            items: [
              { id: 'role-review', label: 'Review', icon: 'user', detail: 'Codex · gpt-5.5', selected: true, disabled: false },
              { id: 'role-conception', label: 'Conception', icon: 'user', detail: 'Claude Code · Opus 5.5', selected: false, disabled: false },
            ],
          },
          {
            label: 'Serveur MCP',
            items: [
              { id: 'mcp-stitch', label: 'Stitch', icon: 'layers', detail: 'déjà attaché', selected: false, disabled: true },
              { id: 'mcp-figma', label: 'Figma', icon: 'layers', detail: 'donne ses outils aux agents de l’Étape', selected: false, disabled: false },
            ],
          },
        ],
      },
    },
  ],
});
