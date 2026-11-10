import { z } from 'zod';
import { defineComposant } from './define.js';
import { zIconName } from './icons.js';
import { zTone } from './tone.js';

/** A generic row of a list; with `href` the whole row is a link, which the router follows. */
export const ListRow = defineComposant({
  name: 'ListRow',
  version: 1,
  tag: 'cd-list-row',
  category: 'partie',
  description: 'Une ligne de liste générique, un lien quand elle mène quelque part.',
  data: z.object({
    title: z.string(),
    meta: z.string().optional(),
    icon: zIconName.optional(),
    tone: zTone.optional(),
    href: z.string().optional(),
  }),
  actions: {},
  slots: ['trailing'],
  examples: [
    { name: 'simple', data: { title: 'Crewdeck', meta: 'MaximeD1412/Crewdeck' } },
    {
      name: 'lien avec icône',
      data: { title: 'Runner et Comptes IA', meta: 'Claude Code, Codex', icon: 'server', tone: 'go', href: '/runner' },
      slots: { trailing: `<cd-status-badge data='{"tone":"go","label":"en ligne"}'></cd-status-badge>` },
    },
  ],
});
