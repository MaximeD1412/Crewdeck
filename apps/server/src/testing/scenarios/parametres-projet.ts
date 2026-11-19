import { DEFAULT_ACCOUNT_SETTINGS } from '@crewdeck/contracts';
import { storedEngine } from '../../runners/ai-accounts/ai-account.view.js';
import { newCustomRoleId, roleNameKey } from '../../settings/roles.js';
import { sealTestItem, seedTrustedDevice } from '../test-vault.js';
import type { ScenarioContext } from './define.js';
import { defineScenario } from './define.js';
import { seedRepositories } from './projets.js';
import { RUNNER_MACHINE, withAccounts } from './runner.js';

/** « Site mairie », the Projet of `parametres-projet`'s mockup: its page names it. */
export const SITE_MAIRIE_ID = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6e01';

/** The worktree Commandes « Site mairie » keeps sealed, as the trusted Appareil opens them. */
export const SITE_MAIRIE_WORKTREE = { prepare: 'pnpm install --frozen-lockfile', clean: 'rm -rf node_modules/.cache' } as const;

/**
 * The account of `parametres`' mockup: the Pilote signed in, their Runner
 * online with both Comptes IA, the Idée on Sonnet 5.5 (stored), push on, the Rôle
 * « Revue Codex » on GPT-5.5; the Projets Crewdeck, Personal OS and Site
 * mairie, the last with the Code on Codex GPT-5.5 and the Review on Claude
 * Code Opus 5.5 (`parametres-projet`'s mockup), its worktree Commandes sealed
 * under the test vault when `worktree`.
 */
export const seedParametresAccount = async (
  ctx: ScenarioContext,
  { worktree, signIn }: { worktree: boolean; signIn?: Parameters<typeof withAccounts>[2] },
) => {
  const { token, ...seed } = await withAccounts(ctx, undefined, signIn);
  await ctx.prisma.unscoped.accountSettings.create({
    data: {
      pilotId: seed.pilotId,
      roles: { ...DEFAULT_ACCOUNT_SETTINGS.roles, idea: { engine: 'claude-code', model: 'claude-sonnet-5-5' } },
      notificationsPush: true,
    },
  });
  const name = 'Revue Codex';
  await ctx.prisma.unscoped.customRole.create({
    data: { id: newCustomRoleId(), pilotId: seed.pilotId, name, nameKey: roleNameKey(name), engine: storedEngine('codex'), model: 'gpt-5.5' },
  });
  await seedRepositories(ctx, seed.pilotId, [
    { name: 'crewdeck', hasCode: true, project: 'Crewdeck' },
    { name: 'personal-os', hasCode: true, project: 'Personal OS' },
    { name: 'site-mairie', hasCode: true, project: 'Site mairie', projectId: SITE_MAIRIE_ID },
  ]);
  await ctx.prisma.unscoped.projectSettings.create({
    data: {
      projectId: SITE_MAIRIE_ID,
      pilotId: seed.pilotId,
      roles: { code: { engine: 'codex', model: 'gpt-5.5' }, review: { engine: 'claude-code', model: 'claude-opus-5-5' } },
      ...(worktree ? { worktreeCommands: { ...(await sealTestItem(JSON.stringify(SITE_MAIRIE_WORKTREE), `settings:${SITE_MAIRIE_ID}`)) } } : {}),
    },
  });
  return { ...seed, runnerToken: token, runnerMachine: RUNNER_MACHINE };
};

/**
 * The Paramètres of « Site mairie » (`design/screens.json`:
 * `parametres-projet`): its Rôles, the Idée and the Conception inherited, the
 * Code and the Review changed for it; « Étapes »; its branches; its worktree
 * Commandes, sealed, which this browser opens once the e2e made it the
 * trusted Appareil of the test vault (`apps/web/e2e/trusted-device.ts`);
 * push inherited. The Planifications are BOUCLE-8's.
 */
export const parametresProjet = defineScenario({
  name: 'parametres-projet',
  path: `/projets/${SITE_MAIRIE_ID}/parametres`,
  seed: async (ctx) => {
    const seed = await seedParametresAccount(ctx, { worktree: true });
    await seedTrustedDevice(ctx.prisma, seed.pilotId);
    return seed;
  },
});
