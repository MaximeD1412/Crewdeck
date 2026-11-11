import { z } from 'zod';
import { defineComposant } from './define.js';

/**
 * A modal dialog a Skin may replace (the confirmation of an Action sensible is
 * not one: `crewdeck-confirm`). Open while `open`; « Fermer », Escape and a
 * click on the scrim emit `close`, and the Composant that placed it sets
 * `open` to false. Its body in the default Emplacement, its buttons in
 * `actions`.
 */
export const Dialog = defineComposant({
  name: 'Dialog',
  version: 1,
  tag: 'cd-dialog',
  category: 'partie',
  description: 'Une fenêtre modale, avec son titre, son contenu et ses boutons.',
  data: z.object({ open: z.boolean(), title: z.string() }),
  actions: { close: z.object({}) },
  slots: ['default', 'actions'],
  examples: [
    {
      name: 'noter une Idée',
      data: { open: true, title: 'Noter une Idée' },
      slots: {
        default: `<cd-text-field data='{"name":"idea","label":"Ton idée","value":"","placeholder":"En une phrase","help":null,"error":null,"state":null,"multiline":true,"maxLength":2000}'></cd-text-field>`,
        actions: `<cd-button data='{"label":"Annuler","variant":"ghost","size":"md"}'></cd-button><cd-button data='{"label":"Noter","variant":"primary","size":"md"}'></cd-button>`,
      },
    },
  ],
});
