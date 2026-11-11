import { z } from 'zod';
import { defineComposant } from './define.js';

/** A tool asking the Pilote's permission to run a command: « Autoriser », « Autoriser pour la session », « Refuser ». */
export const PermissionRequest = defineComposant({
  name: 'PermissionRequest',
  version: 1,
  tag: 'cd-permission-request',
  category: 'partie',
  description: 'Une demande de permission d’un outil.',
  data: z.object({ id: z.string().min(1), tool: z.string(), command: z.string() }),
  actions: {
    allow: z.object({ id: z.string().min(1) }),
    allowForSession: z.object({ id: z.string().min(1) }),
    deny: z.object({ id: z.string().min(1) }),
  },
  slots: [],
  examples: [{ name: 'un git push', data: { id: 'p-push-1', tool: 'Bash', command: 'git push origin design/agenda-partage' } }],
});
