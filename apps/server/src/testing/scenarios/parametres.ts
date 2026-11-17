import { DEFAULT_ACCOUNT_SETTINGS } from '@crewdeck/contracts';
import { storedEngine } from '../../runners/ai-accounts/ai-account.view.js';
import { newCustomRoleId, roleNameKey } from '../../settings/roles.js';
import { defineScenario } from './define.js';
import { RUNNER_MACHINE, withAccounts } from './runner.js';

/**
 * The Paramètres of the account (`design/screens.json`: `parametres`), the
 * Pilote signed in by email, GitHub not linked (« Connexion » offers « Relier
 * GitHub », CORE-11), their Runner online with both Comptes IA (Claude Code by
 * subscription, Codex by API key, GPT-5.5 Pro at its quota): « Rôles et
 * modèles » as the mockup shows it, the Idée on Sonnet 5.5 (stored), the
 * Conception and the Code on Opus 5.5 and the Review on GPT-5.5 (their
 * defaults), then the Rôle the Pilote added, « Revue Codex » on GPT-5.5;
 * « Compte » with the time zone; « Pour les Moddeurs ». The other sections
 * are their tickets'.
 */
export const parametres = defineScenario({
  name: 'parametres',
  path: '/parametres',
  seed: async (ctx) => {
    const { token, ...seed } = await withAccounts(ctx, undefined, { identities: ['email'] });
    await ctx.prisma.unscoped.accountSettings.create({
      data: {
        pilotId: seed.pilotId,
        roles: { ...DEFAULT_ACCOUNT_SETTINGS.roles, idea: { engine: 'claude-code', model: 'claude-sonnet-5-5' } },
        optionalSteps: DEFAULT_ACCOUNT_SETTINGS.optionalSteps,
      },
    });
    const name = 'Revue Codex';
    await ctx.prisma.unscoped.customRole.create({
      data: { id: newCustomRoleId(), pilotId: seed.pilotId, name, nameKey: roleNameKey(name), engine: storedEngine('codex'), model: 'gpt-5.5' },
    });
    return { ...seed, runnerToken: token, runnerMachine: RUNNER_MACHINE };
  },
});
