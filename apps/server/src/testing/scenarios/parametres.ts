import { DEFAULT_ACCOUNT_SETTINGS } from '@crewdeck/contracts';
import { newId } from '../../ids.js';
import { storedEngine } from '../../runners/ai-accounts/ai-account.view.js';
import { newCustomRoleId, roleNameKey } from '../../settings/roles.js';
import { defineScenario } from './define.js';
import { RUNNER_MACHINE, withAccounts } from './runner.js';

/**
 * The Paramètres of the account (`design/screens.json`: `parametres`), the
 * Pilote signed in, their Runner online with both Comptes IA (Claude Code by
 * subscription, Codex by API key, GPT-5.5 Pro at its quota): « Rôles et
 * modèles » as the mockup shows it, the Idée on Sonnet 5.5 (stored), the
 * Conception and the Code on Opus 5.5 and the Review on GPT-5.5 (their
 * defaults), then the Rôle the Pilote added, « Revue Codex » on GPT-5.5;
 * « Notifications » with the push on and the Pilote's iPhone authorized on
 * 3 nov. (a push service that does not exist: no Décision is pushed here);
 * « Compte » with the time zone; « Pour les Moddeurs ». The other sections
 * are their tickets'.
 */
export const parametres = defineScenario({
  name: 'parametres',
  path: '/parametres',
  seed: async (ctx) => {
    const { token, ...seed } = await withAccounts(ctx);
    await ctx.prisma.unscoped.accountSettings.create({
      data: {
        pilotId: seed.pilotId,
        roles: { ...DEFAULT_ACCOUNT_SETTINGS.roles, idea: { engine: 'claude-code', model: 'claude-sonnet-5-5' } },
        optionalSteps: DEFAULT_ACCOUNT_SETTINGS.optionalSteps,
        notificationsPush: true,
      },
    });
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
    const name = 'Revue Codex';
    await ctx.prisma.unscoped.customRole.create({
      data: { id: newCustomRoleId(), pilotId: seed.pilotId, name, nameKey: roleNameKey(name), engine: storedEngine('codex'), model: 'gpt-5.5' },
    });
    return { ...seed, runnerToken: token, runnerMachine: RUNNER_MACHINE };
  },
});
