import { z } from 'zod';
import { defineComposant } from './define.js';
import { FORM_CONTROL_NOTE } from './form.js';

/**
 * A choice among options: the native `<select>` (no custom dropdown, the
 * phones' pickers), a form control (`form.ts`). With an `error` it reports
 * itself invalid to its form and shows the message under it, which describes it.
 */
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
    error: z.string().optional(),
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
      name: 'en erreur',
      data: {
        name: 'review',
        label: 'Review',
        value: 'codex:gpt-5.5-pro',
        options: [
          { value: 'codex:gpt-5.5-pro', label: 'Codex · GPT-5.5 Pro', disabled: false },
          { value: 'codex:gpt-5.5', label: 'Codex · GPT-5.5', disabled: false },
        ],
        help: null,
        error: 'Quota atteint : choisis un autre modèle.',
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
