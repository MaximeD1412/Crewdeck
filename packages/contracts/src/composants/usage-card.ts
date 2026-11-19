import { z } from 'zod';
import { defineComposant } from './define.js';
import { UsageMeter } from './usage-meter.js';

/**
 * A Compte IA in a `UsageCard`: its title (none when the card's meters name
 * it), its windows, an API key's month spend, and `note`, when its measures
 * are the last before the Runner went offline (« Dernière mesure à 14:02,
 * avant que le Runner se coupe. »).
 */
export const zUsageCardAccount = z.object({
  title: z.string().min(1).nullable(),
  meters: z.array(UsageMeter.data),
  note: z.string().min(1).nullable(),
  /** The month's estimated spend, formatted (« 21,60 € »), for an API key; `null` otherwise. */
  monthSpend: z.string().min(1).nullable(),
});

/**
 * The usage of the Pilote's Comptes IA (US-55, RUNNER-13): a card titled
 * `title`, each Compte IA with its title, its note, a `UsageMeter` per window
 * and, for an API key, « Dépense estimée du mois » (a Compte IA without a
 * title has its note under its meters). `/runner` places it in its `usage`
 * Emplacement, « À toi » in `ai-accounts`, compact: no title, the meters
 * named after their Compte IA.
 */
export const UsageCard = defineComposant({
  name: 'UsageCard',
  version: 1,
  tag: 'cd-usage-card',
  category: 'partie',
  description: 'L’usage des Comptes IA face à leurs limites, et la dépense estimée du mois d’une clé API.',
  data: z.object({ title: z.string().min(1), accounts: z.array(zUsageCardAccount).min(1) }),
  actions: {},
  slots: [],
  examples: [
    {
      name: 'abonnement et clé API',
      data: {
        title: 'Usage des Comptes IA',
        accounts: [
          {
            title: 'Claude · abonnement',
            meters: [
              { label: 'Fenêtre de 5 h', value: 100, detail: '16:40', projection: 'Limite atteinte ; réinitialisation à 16:40.', tone: null },
              {
                label: 'Semaine',
                value: 62,
                detail: 'lundi',
                projection: 'Réinitialisation lundi ; au rythme actuel, la semaine tient jusqu’à jeudi.',
                tone: null,
              },
            ],
            monthSpend: null,
            note: null,
          },
          { title: 'Codex · clé API', meters: [], monthSpend: '21,60 €', note: null },
        ],
      },
    },
    {
      name: 'Runner hors ligne',
      data: {
        title: 'Usage des Comptes IA',
        accounts: [
          {
            title: 'Claude · abonnement',
            meters: [{ label: 'Fenêtre de 5 h', value: 84, detail: '16:40', projection: 'Réinitialisation à 16:40.', tone: null }],
            monthSpend: null,
            note: 'Dernière mesure à 14:02, avant que le Runner se coupe.',
          },
        ],
      },
    },
    {
      name: 'compact, dans « À toi »',
      data: {
        title: 'Comptes IA',
        accounts: [
          {
            title: null,
            meters: [
              { label: 'Claude · 5 h', value: 100, detail: '16:40', projection: null, tone: null },
              { label: 'Claude · semaine', value: 62, detail: null, projection: 'Au rythme actuel, la semaine de Claude tient jusqu’à jeudi.', tone: null },
            ],
            monthSpend: null,
            note: null,
          },
        ],
      },
    },
  ],
});
