import { z } from 'zod';
import { defineComposant } from './define.js';
import { placed } from './placed.js';

/**
 * The sections of the Paramètres, in their order: each an Emplacement the
 * core fills with its Card, the ticket of each section its own (PARAM-2
 * `roles`, ATOI-4 `notifications`, E2E-3 `devices`, BOUCLE-8 `schedules`, PARAM-4
 * `optional-steps`, PARAM-3 `projects`).
 */
export const SETTINGS_SECTIONS = ['roles', 'notifications', 'devices', 'schedules', 'optional-steps', 'projects', 'account', 'modders'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const TIME_ZONE = placed(
  'cd-card',
  { title: 'Compte', label: 'Paramètres / Compte' },
  undefined,
  placed(
    'cd-setting-row',
    { label: 'Fuseau horaire', help: 'Pour les Planifications et les statistiques par jour.', origin: null },
    undefined,
    placed('cd-select', {
      name: 'timeZone',
      label: 'Zone IANA',
      value: 'Europe/Paris',
      options: ['America/Montreal', 'Asia/Tokyo', 'Europe/Paris'].map((zone) => ({ value: zone, label: zone, disabled: false })),
      help: null,
      state: null,
    }),
  ),
);

const MODDERS = placed(
  'cd-card',
  { title: 'Pour les Moddeurs', label: 'Paramètres / Pour les Moddeurs', flush: true },
  undefined,
  placed(
    'cd-list-row',
    {
      title: 'Bibliothèque de Composants',
      meta: 'chaque Composant, ses données, ses actions et ses Emplacements',
      icon: 'layers',
      href: '/parametres/composants',
    },
    undefined,
    placed('cd-icon', { name: 'chevron-right', size: 'sm' }, 'trailing'),
  ),
);

/**
 * The Paramètres of the account (US-82, `/parametres`): its header, the nav
 * of its sections, then each section's Card in its Emplacement. An empty
 * Emplacement is hidden, its link too. On the phone one section shows at a
 * time, the one its link opens; at 1280 px all of them, the nav beside.
 * A form control of a section changing (its native `change`) emits `change`
 * with its `name` and its value (`checked` for a Toggle).
 */
export const PageParametres = defineComposant({
  name: 'PageParametres',
  version: 1,
  tag: 'cd-page-parametres',
  category: 'page',
  description: 'Les Paramètres du compte, une section par Emplacement.',
  data: z.object({}),
  actions: { change: z.object({ name: z.string().min(1), value: z.union([z.string(), z.boolean()]) }) },
  slots: SETTINGS_SECTIONS,
  examples: [
    { name: 'le compte et les Moddeurs', data: {}, slots: { account: TIME_ZONE, modders: MODDERS } },
    { name: 'une seule section', data: {}, slots: { modders: MODDERS } },
  ],
});
