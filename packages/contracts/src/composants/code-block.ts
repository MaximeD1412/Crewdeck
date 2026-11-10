import { z } from 'zod';
import { defineComposant } from './define.js';

/** A command, with « Copier », which copies it and says « Copié » for 2 s; no action. */
export const CodeBlock = defineComposant({
  name: 'CodeBlock',
  version: 1,
  tag: 'cd-code-block',
  category: 'partie',
  description: 'Une commande, avec « Copier ».',
  data: z.object({ code: z.string() }),
  actions: {},
  slots: [],
  examples: [{ name: 'une commande', data: { code: 'curl -fsSL https://crewdeck.example/runner.sh | sh' } }],
});
