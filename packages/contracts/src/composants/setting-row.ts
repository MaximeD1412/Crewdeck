import { z } from 'zod';
import { defineComposant } from './define.js';

/**
 * A setting of the Paramètres: its label, its help, where its value comes
 * from (`compte`: inherited from the account, `projet`: changed for this
 * Projet), and its control in the default Emplacement.
 */
export const SettingRow = defineComposant({
  name: 'SettingRow',
  version: 1,
  tag: 'cd-setting-row',
  category: 'partie',
  description: 'Un réglage des Paramètres : son libellé, son aide, d’où vient sa valeur, et son contrôle.',
  data: z.object({
    label: z.string(),
    help: z.string().nullable(),
    origin: z.enum(['compte', 'projet']).nullable(),
  }),
  actions: {},
  slots: ['default'],
  examples: [
    {
      name: 'hérité du compte',
      data: { label: 'Rôle Review', help: 'Le Moteur qui relit les PR.', origin: 'compte' },
      slots: {
        default: `<cd-select data='{"name":"review","label":"Moteur","value":"codex","options":[{"value":"codex","label":"Codex · gpt-5.5","disabled":false},{"value":"claude-code","label":"Claude Code · claude-opus-5-5","disabled":false}],"help":null,"state":null}'></cd-select>`,
      },
    },
    {
      name: 'modifié pour ce Projet',
      data: { label: 'Revue visuelle', help: 'Étape optionnelle', origin: 'projet' },
      slots: {
        default: `<cd-toggle data='{"name":"visualReview","label":"Activée","checked":true,"help":null,"state":null}'></cd-toggle>`,
      },
    },
    {
      name: 'sans origine',
      data: { label: 'Nom du Projet', help: null, origin: null },
      slots: {
        default: `<cd-text-field data='{"name":"name","label":"Nom","value":"Crewdeck","placeholder":null,"help":null,"error":null,"state":null,"multiline":false,"maxLength":80}'></cd-text-field>`,
      },
    },
  ],
});
