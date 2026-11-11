import { z } from 'zod';
import { defineComposant } from './define.js';

/** A tool an agent called, in mono: its name, what it touched, what it returned. */
export const ToolCall = defineComposant({
  name: 'ToolCall',
  version: 1,
  tag: 'cd-tool-call',
  category: 'partie',
  description: 'Un appel d’outil d’un agent.',
  data: z.object({ tool: z.string(), target: z.string().nullable(), detail: z.string().nullable() }),
  actions: {},
  slots: [],
  examples: [
    { name: 'une lecture', data: { tool: 'Read', target: 'docs/product/prd.md', detail: '281 lignes' } },
    { name: 'sans cible ni détail', data: { tool: 'TodoWrite', target: null, detail: null } },
  ],
});
