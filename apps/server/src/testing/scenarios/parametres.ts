import { newId } from '../../ids.js';
import { defineScenario } from './define.js';
import { seedParametresAccount } from './parametres-projet.js';

/**
 * The Paramètres of the account (`design/screens.json`: `parametres`), the
 * Pilote signed in by email, GitHub not linked (« Connexion » offers « Relier
 * GitHub », CORE-11), their Runner online with both Comptes IA (Claude Code by
 * subscription, Codex by API key, GPT-5.5 Pro at its quota): « Rôles et
 * modèles » as the mockup shows it, the Idée on Sonnet 5.5 (stored), the
 * Conception and the Code on Opus 5.5 and the Review on GPT-5.5 (their
 * defaults), then the Rôle the Pilote added, « Revue Codex » on GPT-5.5;
 * « Notifications » with the push on and the Pilote's iPhone authorized on
 * 3 nov. (a push service that does not exist: no Décision is pushed here);
 * « Compte » with the time zone; « Par Projet », Crewdeck and Personal OS
 * inheriting the account, Site mairie with two Paramètres changed; « Pour les
 * Moddeurs ». The other sections are their tickets'.
 */
export const parametres = defineScenario({
  name: 'parametres',
  path: '/parametres',
  seed: async (ctx) => {
    const seed = await seedParametresAccount(ctx, { worktree: false, signIn: { identities: ['email'] } });
    await ctx.prisma.unscoped.pushSubscription.create({
      data: {
        id: newId(),
        pilotId: seed.pilotId,
        endpoint: `https://push.invalid/${seed.pilotId}`,
        p256dh: 'B'.padEnd(87, 'A'),
        auth: 'A'.repeat(22),
        label: 'Safari · iPhone',
        createdAt: new Date('2026-11-03T09:00:00.000Z'),
      },
    });
    return seed;
  },
});

/** The same Paramètres, the capture showing « Notifications » (its section opened at 390 px): this browser may subscribe. */
export const parametresNotifications = defineScenario({ ...parametres, name: 'parametres-notifications' });

/** The same, the capture's browser without `PushManager` (an iPhone outside the home-screen app): the help instead of the button. */
export const parametresNotificationsIphone = defineScenario({ ...parametres, name: 'parametres-notifications-iphone' });
