import { PROCESS_CREWDECK, PROCESS_CREWDECK_NAME, PROCESS_LABELS, projectNameAad, type ProcessDefinition } from '@crewdeck/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { newId } from '../../ids.js';
import { createAiAccounts, createLinkedRunner } from '../runners.js';
import { sealItem } from '../vault.js';
import type { ScenarioContext, ScenarioSeed } from './define.js';
import { defineScenario } from './define.js';
import { CLAUDE_SUBSCRIPTION, CODEX_API_KEY } from './engines.js';
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
  /** What its readiness finds on GitHub (PROJET-3): the Process's labels already there, its integration branch `develop` pushed. */
  readonly labels?: boolean;
  readonly integration?: boolean;
  /** Its Inventaire's state; by default `pending` with code, `not_needed` without. */
  readonly inventoryState?: 'pending' | 'to_approve' | 'approved';
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
  for (const [index, { name, hasCode, project, projectId: knownProjectId, labels, integration, inventoryState }] of repositories.entries()) {
    const githubId = 72000001 + index;
    const ref = ctx.fakes.github.seedRepo({ owner, name, id: githubId, installationId: SCENARIO_INSTALLATION_ID });
    // « Has code » as GitHub would count it: a commit past the initial one, which the reconciliation counts again.
    if (hasCode) await ctx.fakes.github.pushCommit(ref, 'main', { 'src/index.ts': `// ${name}\n` });
    if (integration) await ctx.fakes.github.pushCommit(ref, 'develop');
    if (labels) ctx.fakes.github.seedLabels(ref, PROCESS_LABELS);
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
        inventoryState: inventoryState ?? (hasCode ? 'pending' : 'not_needed'),
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
  ctx.fakes.runner.seedFolder(RECETTES_FOLDER, { state: 'ready', hasCode: true, branch: 'main', branches: ['main', 'develop'] });
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

/** « Site mairie », whose page `projet` opens. */
export const SITE_MAIRIE_ID = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6b11';

/**
 * The Pilote's Runner `atelier-pc`, online, and both Comptes IA connected
 * (Claude by subscription, Codex by API key): every Rôle has a Moteur.
 */
const withReadyRunner = async (ctx: ScenarioContext, pilotId: string): Promise<Pick<ScenarioSeed, 'runnerToken' | 'runnerMachine'>> => {
  const { token } = await createLinkedRunner(ctx.prisma, pilotId, RUNNER_MACHINE);
  await createAiAccounts(ctx.prisma, pilotId, [CLAUDE_SUBSCRIPTION, CODEX_API_KEY]);
  return { runnerToken: token, runnerMachine: RUNNER_MACHINE };
};

/**
 * The four Projets of « Projets »' mockup, the Runner online: Personal OS and
 * Crewdeck ready, Site mairie without its integration branch, Tennis Manager
 * whose Inventaire waits for approval; and a repository still only a Dépôt
 * GitHub for « Ajouter un Projet ».
 */
const seedProjets = async (ctx: ScenarioContext): Promise<ScenarioSeed> => {
  const seed = await signInPilot(ctx);
  const ready = { hasCode: true, labels: true, integration: true, inventoryState: 'approved' } as const;
  await seedRepositories(ctx, seed.pilotId, [
    { name: 'personal-os', project: 'Personal OS', ...ready },
    { name: 'site-mairie', project: 'Site mairie', projectId: SITE_MAIRIE_ID, ...ready, integration: false },
    { name: 'crewdeck', project: 'Crewdeck', ...ready },
    { name: 'tennis-manager', project: 'Tennis Manager', ...ready, inventoryState: 'to_approve' },
    { name: 'sandbox-vue3', hasCode: false },
  ]);
  return { ...seed, ...(await withReadyRunner(ctx, seed.pilotId)) };
};

/**
 * « Projets » (`design/screens.json`: `projets`): four Projets followed, each
 * with its readiness's badge (PROJET-3), one repository still only a Dépôt
 * GitHub for « Ajouter un Projet ».
 */
export const projets = defineScenario({ name: 'projets', path: '/projets', seed: seedProjets });

/**
 * A GitHub Projet's page (`projet`): « Site mairie », whose Process waits for
 * its integration branch `develop`, « Corriger » creating it on GitHub; every
 * other check met.
 */
export const projet = defineScenario({ name: 'projet', path: `/projets/${SITE_MAIRIE_ID}`, seed: seedProjets });

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
 * « Process Crewdeck » for a Local Projet, as its activation leaves it: its
 * « Checks » on the Projet's Commandes, no CI without GitHub.
 */
const LOCAL_ACTIVE: ProcessDefinition = (() => {
  const definition = structuredClone(PROCESS_CREWDECK) as ProcessDefinition;
  const checks = definition.steps.find((step) => step.id === 'st-checks');
  if (checks) checks.tools = [{ kind: 'command', commandId: 'tests' }];
  return definition;
})();

/**
 * Recettes, the Local Projet of `projet-local`, from the folder
 * `~/projets/recettes` the Runner `atelier-pc` keeps, every group Local, no
 * code to inventory; its Process active (« Process Crewdeck » on its
 * Commandes), both Comptes IA connected: ready (PROJET-3). `folder` the
 * folder it keeps, `~/projets/recettes` by default.
 */
const seedRecettes = async (ctx: ScenarioContext, folder: string = RECETTES_FOLDER): Promise<ScenarioSeed> => {
  const seed = await signInPilot(ctx);
  const { runner, vaultKey } = await withRunnerFolders(ctx, seed.pilotId);
  const { pilotId } = seed;
  const projectId = RECETTES.id;
  await createAiAccounts(ctx.prisma, pilotId, [CLAUDE_SUBSCRIPTION, CODEX_API_KEY]);
  await ctx.prisma.unscoped.project.create({
    data: {
      id: projectId,
      pilotId,
      nameSealed: sealItem(vaultKey, RECETTES.name, projectNameAad(projectId)) as unknown as Prisma.InputJsonValue,
      folderState: 'present',
      releaseBranch: 'main',
      integrationBranch: 'develop',
      hasCode: false,
      inventoryState: 'not_needed',
      followedAt: RECETTES.followedAt,
    },
  });
  await ctx.prisma.unscoped.artifactSource.createMany({
    data: (['ticket', 'code'] as const).map((group) => ({ id: newId(), pilotId, projectId, group, source: 'local' as const, since: RECETTES.followedAt })),
  });
  await ctx.prisma.unscoped.processVersion.create({
    data: {
      id: newId(),
      pilotId,
      projectId,
      number: 1,
      definition: LOCAL_ACTIVE as unknown as Prisma.InputJsonValue,
      sealed: Prisma.DbNull,
      activatedAt: RECETTES.followedAt,
      activatedBy: 'pilot',
      templateName: PROCESS_CREWDECK_NAME,
    },
  });
  ctx.fakes.runner.keepFolder(projectId, folder);
  return { ...seed, ...runner };
};

/** A Local Projet's page (`projet-local`): « Recettes », ready. */
export const projetLocal = defineScenario({ name: 'projet-local', path: `/projets/${RECETTES.id}`, seed: (ctx) => seedRecettes(ctx) });

/** `projet-local` whose folder has no git yet: « Corriger » makes it a repository with `main` and `develop` (PROJET-3). */
export const projetLocalAPreparer = defineScenario({ name: 'projet-local-a-preparer', path: `/projets/${RECETTES.id}`, seed: (ctx) => seedRecettes(ctx, CARNET_FOLDER) });

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

/**
 * « Premiers pas »' last step for a Pilote signed in by email, GitHub not
 * linked (CORE-11): the Banner « Relier GitHub » above an empty picker.
 */
export const demarrageProjetsSansGithub = defineScenario({
  name: 'demarrage-projets-sans-github',
  path: '/demarrage',
  seed: (ctx) => signInPilot(ctx, { gettingStartedStep: 'projects', identities: ['email'] }),
});

/**
 * `demarrage-projets` on its folder tab, for the visual review: the form of
 * a folder of the Runner's machine (no mockup yet, `demarrage-projets` being
 * GitHub only). The capture opens the tab and types `RECETTES_FOLDER`.
 */
export const demarrageProjetsDossier = defineScenario({ ...demarrageProjets, name: 'demarrage-projets-dossier' });
