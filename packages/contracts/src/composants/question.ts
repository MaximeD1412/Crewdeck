import { z } from 'zod';
import { defineComposant } from './define.js';

/**
 * A question an agent asks: radios, or checkboxes when `multiple`, then
 * « Répondre ». The free answer goes through the Composer.
 */
export const Question = defineComposant({
  name: 'Question',
  version: 1,
  tag: 'cd-question',
  category: 'partie',
  description: 'Une question d’un agent, et ses options.',
  data: z.object({
    id: z.string().min(1),
    kicker: z.string().nullable(),
    title: z.string(),
    options: z.array(
      z.object({ id: z.string().min(1), label: z.string(), detail: z.string().nullable(), selected: z.boolean() }),
    ),
    multiple: z.boolean(),
  }),
  actions: { answer: z.object({ questionId: z.string().min(1), optionIds: z.array(z.string().min(1)) }) },
  slots: [],
  examples: [
    {
      name: 'une option, la Reco choisie',
      data: {
        id: 'q-agenda-1',
        kicker: 'Question 1 sur 3',
        title: 'Qui peut modifier un événement d’un agenda partagé ?',
        options: [
          {
            id: 'tous',
            label: 'Tous les membres de l’agenda',
            detail: 'Reco : la règle la plus simple, et l’agenda reste à jour quel que soit l’auteur.',
            selected: true,
          },
          { id: 'auteur', label: 'Seulement son auteur', detail: 'Les autres membres le voient en lecture seule.', selected: false },
          { id: 'au-choix', label: 'Au choix, pour chaque agenda', detail: 'Chaque agenda dit qui peut modifier ses événements.', selected: false },
        ],
        multiple: false,
      },
    },
    {
      name: 'plusieurs options',
      data: {
        id: 'q-agenda-2',
        kicker: null,
        title: 'Quels rappels un événement peut-il avoir ?',
        options: [
          { id: 'notification', label: 'Une notification', detail: null, selected: true },
          { id: 'email', label: 'Un e-mail', detail: null, selected: false },
          { id: 'sms', label: 'Un SMS', detail: 'Payant, au-delà de 50 par mois.', selected: false },
        ],
        multiple: true,
      },
    },
  ],
});
