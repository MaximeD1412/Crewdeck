import { PROCESS_CREWDECK, PROCESS_CREWDECK_NAME, projectNameAad } from '@crewdeck/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { newId } from '../../ids.js';
import { createLinkedRunner } from '../runners.js';
import { sealItem } from '../vault.js';
import type { ScenarioContext, ScenarioSeed } from './define.js';
import { defineScenario } from './define.js';
import { seedTrustedDevice } from './idees.js';
import { RUNNER_MACHINE } from './runner.js';
import { OCTOCAT, signInPilot } from './sign-in.js';

/** The installation of the App the scenarios' Pilote made, on their own account. */
export const SCENARIO_INSTALLATION_ID = 61000001;

interface SeededRepository {
  readonly name: string;
  readonly hasCode: boolean;
  /** The Projet following it, by its name; none when the repository is only a Dépôt GitHub. */
  readonly project?: string;
  /** That Projet's id, when a scenario names it elsewhere (a Décision, a PhaseRun); else a new one. */
  readonly projectId?: string;
}

/**
 * The Pilote's installation with `repositories`, as the webhooks would leave
 * it: in the fake GitHub (those with code have two commits) and in `repositories`, with a Projet for those
 * that name one: a reconciliation finds them as they are.
 */
export const seedRepositories = async (ctx: ScenarioContext, pilotId: string, repositories: readonly SeededRepository[]): Promise<void> => {
  const owner = OCTOCAT.login;
  await ctx.prisma.unscoped.gitHubInstallation.create({
    data: { installationId: BigInt(SCENARIO_INSTALLATION_ID), accountLogin: owner, accountId: BigInt(OCTOCAT.id), senderId: BigInt(OCTOCAT.id), pilotId },
  });
  for (const [index, { name, hasCode, project, projectId: knownProjectId }] of repositories.entries()) {
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
    const projectId = knownProjectId ?? newId();
    await ctx.prisma.unscoped.project.create({
      data: {
        id: projectId,
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
    // Its Sources and its version 1, « Process Crewdeck », as following it writes.
    await ctx.prisma.unscoped.artifactSource.createMany({
      data: (['ticket', 'code'] as const).map((group) => ({ id: newId(), pilotId, projectId, group, source: 'github' as const, since: new Date() })),
    });
    await ctx.prisma.unscoped.processVersion.create({
      data: {
        id: newId(),
        pilotId,
        projectId,
        number: 1,
        definition: PROCESS_CREWDECK as unknown as Prisma.InputJsonValue,
        sealed: Prisma.DbNull,
        activatedAt: new Date(),
        activatedBy: 'creation',
        templateName: PROCESS_CREWDECK_NAME,
      },
    });
  }
};

/** The folder of `projet-local`'s mockup, a git repository with code. */
export const RECETTES_FOLDER = '~/projets/recettes';
/** A folder without git, for « Pas encore un dépôt git… ». */
export const CARNET_FOLDER = '~/projets/carnet';

/**
 * The Pilote's Appareil, trusted, and their Runner `atelier-pc`, online, with
 * the same vault key: the fake Runner checks the folders the page types
 * (PROJET-6), `~/projets/recettes` a git repository with code on `main`,
 * `~/projets/carnet` a folder without git; any other is missing.
 */
export const withRunnerFolders = async (ctx: ScenarioContext, pilotId: string): Promise<{ runner: Pick<ScenarioSeed, 'device' | 'runnerToken' | 'runnerMachine'>; vaultKey: Buffer }> => {
  const { device, vaultKey } = await seedTrustedDevice(ctx, pilotId);
  const { token } = await createLinkedRunner(ctx.prisma, pilotId, RUNNER_MACHINE);
  ctx.fakes.runner.useVault(vaultKey);
  ctx.fakes.runner.seedFolder(RECETTES_FOLDER, { state: 'ready', hasCode: true, branch: 'main' });
  ctx.fakes.runner.seedFolder(CARNET_FOLDER, { state: 'not-git', hasCode: false, branch: null });
  return { runner: { device, runnerToken: token, runnerMachine: RUNNER_MACHINE }, vaultKey };
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

/**
 * No Projet yet (`projets`, state `vide`); the installation has the mockup's
 * repositories to follow, the Runner the folders of `withRunnerFolders`.
 */
export const projetsVide = defineScenario({
  name: 'projets-vide',
  path: '/projets',
  seed: async (ctx) => {
    const seed = await signInPilot(ctx);
    await seedRepositories(ctx, seed.pilotId, PICKER_REPOSITORIES);
    const { runner } = await withRunnerFolders(ctx, seed.pilotId);
    return { ...seed, ...runner };
  },
});

/** The Local Projet of `projet-local`'s mockup, followed on 10 November. */
export const RECETTES = { id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6b01', name: 'Recettes', followedAt: new Date('2026-11-10T09:00:00.000Z') } as const;

/**
 * A Local Projet's page (`projet-local`): « Recettes », from the folder
 * `~/projets/recettes` the Runner `atelier-pc` keeps, every group Local; its
 * Process a draft of « Process Crewdeck » (« Checks » needs a Commande), as
 * its creation leaves it.
 */
export const projetLocal = defineScenario({
  name: 'projet-local',
  path: `/projets/${RECETTES.id}`,
  seed: async (ctx) => {
    const seed = await signInPilot(ctx);
    const { runner, vaultKey } = await withRunnerFolders(ctx, seed.pilotId);
    const { pilotId } = seed;
    const projectId = RECETTES.id;
    await ctx.prisma.unscoped.project.create({
      data: {
        id: projectId,
        pilotId,
        nameSealed: sealItem(vaultKey, RECETTES.name, projectNameAad(projectId)) as unknown as Prisma.InputJsonValue,
        folderState: 'present',
        releaseBranch: 'main',
        integrationBranch: 'develop',
        hasCode: true,
        inventoryState: 'pending',
        followedAt: RECETTES.followedAt,
      },
    });
    await ctx.prisma.unscoped.artifactSource.createMany({
      data: (['ticket', 'code'] as const).map((group) => ({ id: newId(), pilotId, projectId, group, source: 'local' as const, since: RECETTES.followedAt })),
    });
    await ctx.prisma.unscoped.processDraft.create({
      data: { id: newId(), pilotId, projectId, definition: PROCESS_CREWDECK as unknown as Prisma.InputJsonValue, sealed: Prisma.DbNull, revision: 1, baseVersion: 0, updatedAt: RECETTES.followedAt },
    });
    ctx.fakes.runner.keepFolder(projectId, RECETTES_FOLDER);
    return { ...seed, ...runner };
  },
});

/**
 * « Premiers pas »' last step (`demarrage`, state `projets`): the Pilote's
 * installation reaches four repositories, three with code; they choose which
 * become Projets, or « Plus tard ». The folder tab checks the folders of
 * `withRunnerFolders`.
 */
export const demarrageProjets = defineScenario({
  name: 'demarrage-projets',
  path: '/demarrage',
  seed: async (ctx) => {
    const seed = await signInPilot(ctx, { gettingStartedStep: 'projects' });
    await seedRepositories(ctx, seed.pilotId, PICKER_REPOSITORIES);
    const { runner } = await withRunnerFolders(ctx, seed.pilotId);
    return { ...seed, ...runner };
  },
});
