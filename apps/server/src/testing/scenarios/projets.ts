import { newId } from '../../ids.js';
import type { ScenarioContext } from './define.js';
import { defineScenario } from './define.js';
import { OCTOCAT, signInPilot } from './sign-in.js';

/** The installation of the App the scenarios' Pilote made, on their own account. */
export const SCENARIO_INSTALLATION_ID = 61000001;

interface SeededRepository {
  readonly name: string;
  readonly hasCode: boolean;
  /** The Projet following it, by its name; none when the repository is only a Dépôt GitHub. */
  readonly project?: string;
}

/**
 * The Pilote's installation with `repositories`, as the webhooks would leave
 * it: in the fake GitHub (where following reads `.process.json`, and those
 * with code have two commits) and in `repositories`, with a Projet for those
 * that name one: a reconciliation finds them as they are.
 */
export const seedRepositories = async (ctx: ScenarioContext, pilotId: string, repositories: readonly SeededRepository[]): Promise<void> => {
  const owner = OCTOCAT.login;
  await ctx.prisma.unscoped.gitHubInstallation.create({
    data: { installationId: BigInt(SCENARIO_INSTALLATION_ID), accountLogin: owner, accountId: BigInt(OCTOCAT.id), senderId: BigInt(OCTOCAT.id), pilotId },
  });
  for (const [index, { name, hasCode, project }] of repositories.entries()) {
    const githubId = 72000001 + index;
    const ref = ctx.fakes.github.seedRepo({ owner, name, id: githubId, installationId: SCENARIO_INSTALLATION_ID });
    // « Has code » as GitHub would count it: a commit past the initial one, which the reconciliation counts again.
    if (hasCode) await ctx.fakes.github.pushCommit(ref, 'main', { 'src/index.ts': `// ${name}\n` });
    const id = newId();
    const fullName = `${owner}/${name}`;
    await ctx.prisma.unscoped.repository.create({
      data: { id, pilotId, installationId: BigInt(SCENARIO_INSTALLATION_ID), githubId: BigInt(githubId), owner, name, fullName, private: true, defaultBranch: 'main', hasCode },
    });
    if (project === undefined) continue;
    await ctx.prisma.unscoped.project.create({
      data: {
        id: newId(),
        pilotId,
        repositoryId: id,
        githubRepoId: BigInt(githubId),
        owner,
        name,
        fullName,
        displayName: project,
        releaseBranch: 'main',
        integrationBranch: 'develop',
        hasCode,
        inventoryState: hasCode ? 'pending' : 'not_needed',
      },
    });
  }
};

/** The repositories of « Premiers pas »' mockup: three with code, one empty. */
const PICKER_REPOSITORIES: readonly SeededRepository[] = [
  { name: 'personal-os', hasCode: true },
  { name: 'site-mairie', hasCode: true },
  { name: 'tennis-manager', hasCode: true },
  { name: 'sandbox-vue3', hasCode: false },
];

/**
 * « Projets » (`design/screens.json`: `projets`): four Projets followed, one
 * repository still only a Dépôt GitHub for « Ajouter un Projet ».
 */
export const projets = defineScenario({
  name: 'projets',
  path: '/projets',
  seed: async (ctx) => {
    const seed = await signInPilot(ctx);
    await seedRepositories(ctx, seed.pilotId, [
      { name: 'personal-os', hasCode: true, project: 'Personal OS' },
      { name: 'site-mairie', hasCode: true, project: 'Site mairie' },
      { name: 'crewdeck', hasCode: true, project: 'Crewdeck' },
      { name: 'tennis-manager', hasCode: true, project: 'Tennis Manager' },
      { name: 'sandbox-vue3', hasCode: false },
    ]);
    return seed;
  },
});

/** No Projet yet (`projets`, state `vide`); the installation has the mockup's repositories to follow. */
export const projetsVide = defineScenario({
  name: 'projets-vide',
  path: '/projets',
  seed: async (ctx) => {
    const seed = await signInPilot(ctx);
    await seedRepositories(ctx, seed.pilotId, PICKER_REPOSITORIES);
    return seed;
  },
});

/**
 * « Premiers pas »' last step (`demarrage`, state `projets`): the Pilote's
 * installation reaches four repositories, three with code; they choose which
 * become Projets, or « Plus tard ».
 */
export const demarrageProjets = defineScenario({
  name: 'demarrage-projets',
  path: '/demarrage',
  seed: async (ctx) => {
    const seed = await signInPilot(ctx, { gettingStartedStep: 'projects' });
    await seedRepositories(ctx, seed.pilotId, PICKER_REPOSITORIES);
    return seed;
  },
});
