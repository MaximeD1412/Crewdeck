import { z } from 'zod';
import { zId } from '../values.js';
import { defineComposant } from './define.js';

const IPHONE = { id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01', label: 'Safari · iPhone', meta: 'autorisé le 3 nov.' } as const;
const LAPTOP = { id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a02', label: 'Chrome · Windows', meta: 'autorisé le 12 nov.' } as const;

/**
 * The card « Notifications » of the Paramètres (ATOI-4, US-18): the Toggle
 * « Notifications push » of the account (`toggle`), then each browser that
 * receives them, with « Retirer » (`remove`), then this browser's own way:
 * « Activer sur cet appareil » (`subscribe`, `busy` while the permission and
 * the subscription are on their way) when it is not subscribed (`subscribe`),
 * nothing once it is (`subscribed`), the help to add Crewdeck to the home
 * screen where it cannot receive any (`unavailable`: no `PushManager`, or an
 * iPhone outside the home-screen app). `error`: why the last action failed,
 * whichever it was, shown in every state.
 */
export const PushSettings = defineComposant({
  name: 'PushSettings',
  version: 1,
  tag: 'cd-push-settings',
  category: 'partie',
  description: 'Les notifications push : l’interrupteur du compte, les navigateurs qui les reçoivent, et l’activation sur cet appareil.',
  data: z.object({
    push: z.boolean(),
    subscriptions: z.array(z.object({ id: zId, label: z.string().min(1), meta: z.string().min(1) })),
    device: z.enum(['subscribe', 'subscribed', 'unavailable']),
    busy: z.boolean(),
    error: z.string().nullable(),
  }),
  actions: {
    toggle: z.object({ push: z.boolean() }),
    subscribe: z.object({}),
    remove: z.object({ id: zId }),
  },
  slots: [],
  examples: [
    { name: 'activées sur un iPhone', data: { push: true, subscriptions: [IPHONE], device: 'subscribed', busy: false, error: null } },
    { name: 'à activer sur cet appareil', data: { push: true, subscriptions: [IPHONE, LAPTOP], device: 'subscribe', busy: false, error: null } },
    { name: 'iPhone hors de l’écran d’accueil', data: { push: false, subscriptions: [], device: 'unavailable', busy: false, error: null } },
    {
      name: 'permission refusée',
      data: { push: true, subscriptions: [], device: 'subscribe', busy: false, error: 'Les notifications sont bloquées pour Crewdeck dans ce navigateur.' },
    },
  ],
});
