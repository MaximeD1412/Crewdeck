import { z } from 'zod';
import { defineComposant } from './define.js';
import { FORM_CONTROL_NOTE } from './form.js';

/** A choice among options: the native `<select>` (no custom dropdown, the phones' pickers), a form control (`form.ts`). */
export const Select = defineComposant({
  name: 'Select',
  version: 1,
  tag: 'cd-select',
  category: 'signal',
  description: `Un choix parmi des options, la liste native du navigateur. ${FORM_CONTROL_NOTE}`,
  data: z.object({
    name: z.string(),
    label: z.string(),
    value: z.string(),
    options: z.array(z.object({ value: z.string(), label: z.string(), disabled: z.boolean() })),
    help: z.string().nullable(),
    state: z.enum(['disabled']).nullable(),
  }),
  actions: {},
  slots: [],
  examples: [
    {
      name: 'défaut',
      data: {
        name: 'engine',
        label: 'Moteur du Rôle Code',
        value: 'claude-code',
        options: [
          { value: 'claude-code', label: 'Claude Code · claude-opus-5-5', disabled: false },
          { value: 'codex', label: 'Codex · gpt-5.5', disabled: false },
          { value: 'gemini', label: 'Gemini CLI · aucun Compte IA', disabled: true },
        ],
        help: 'Le Moteur que le Runner lance pour écrire le code.',
        state: null,
      },
    },
    {
      name: 'désactivé',
      data: {
        name: 'runner',
        label: 'Runner',
        value: 'atelier',
        options: [{ value: 'atelier', label: 'atelier', disabled: false }],
        help: null,
        state: 'disabled',
      },
    },
  ],
});
