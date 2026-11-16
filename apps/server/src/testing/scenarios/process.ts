import { DEFAULT_ACCOUNT_SETTINGS, defaultStep, PROCESS_CREWDECK, PROCESS_CREWDECK_NAME, type ProcessDefinition, type SourceGroup, type Step } from '@crewdeck/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { newId } from '../../ids.js';
import type { ScenarioContext, ScenarioSeed } from './define.js';
import { defineScenario } from './define.js';
import { seedRepositories } from './projets.js';
import { RUNNER_MACHINE, withAccounts } from './runner.js';

/** The Projets of these scenarios, by a fixed id: their path names it. */
export const PROCESS_SCENARIO_PROJECTS = {
  mairie: '019a7000-0000-7000-8000-000000000190',
  recettes: '019a7000-0000-7000-8000-000000000191',
  sansVersion: '019a7000-0000-7000-8000-000000000192',
} as const;

/** « Process Crewdeck » with `edits` applied, in order, to a copy. */
const crewdeck = (...edits: ((draft: ProcessDefinition) => void)[]): ProcessDefinition => {
  const draft = structuredClone(PROCESS_CREWDECK);
  for (const edit of edits) edit(draft);
  return draft;
};
const stepOf = (draft: ProcessDefinition, id: string): Step => {
  const step = draft.steps.find((candidate) => candidate.id === id);
  if (step === undefined) throw new Error(`no Étape ${id}`);
  return step;
};

/**
 * The draft of `process-manques`: the shared case `gaps-every-kind` of
 * `packages/contracts/fixtures/process/` (its spec checks they are the same),
 * five Manques of four kinds.
 */
export const MANQUES_DRAFT: ProcessDefinition = crewdeck((draft) => {
  const analyse = stepOf(draft, 'st-analyse');
  analyse.tools = analyse.tools.filter((tool) => tool.kind !== 'role');
  draft.arrows = draft.arrows.filter((arrow) => !(arrow.from.stepId === 'st-review' && arrow.to.stepId === 'st-merge' && arrow.to.portId === 'v-review'));
  draft.steps.push({ ...defaultStep('command', { id: 'st-e2e', phaseId: 'ph-dev', col: 2, row: 2 }), name: 'Tests de bout en bout' });
  draft.arrows.push({ from: { stepId: 'st-code', portId: 'changement' }, to: { stepId: 'st-e2e', portId: 'changement' } });
});

/**
 * The draft of `process-local`, as the mockup draws it: « Checks » on the
 * Projet's Commandes (no CI without GitHub), and a Phase « Livraison » whose
 * Commande Étape « Lancer » takes the merged Changement de code.
 */
export const LOCAL_DRAFT: ProcessDefinition = crewdeck((draft) => {
  stepOf(draft, 'st-checks').tools = [
    { kind: 'command', commandId: 'tests' },
    { kind: 'command', commandId: 'lint' },
  ];
  draft.phases.push({ id: 'ph-livraison', name: 'Livraison', col: 2, row: 3, forEach: null });
  draft.steps.push({
    ...defaultStep('command', { id: 'st-lancer', phaseId: 'ph-livraison', col: 1, row: 1 }),
    name: 'Lancer',
    outputs: [{ id: 'verdict', type: 'delivery' }],
    tools: [{ kind: 'command', commandId: 'lancer' }],
  });
  draft.arrows.push({ from: { stepId: 'st-merge', portId: 'changement' }, to: { stepId: 'st-lancer', portId: 'changement' } });
  draft.commands.push({ id: 'tests' }, { id: 'lint' }, { id: 'lancer' });
});

const json = (definition: ProcessDefinition) => definition as unknown as Prisma.InputJsonValue;

interface ProjectProcess {
  /** The versions activated, oldest first, by their day; the last is the active one. */
  readonly versions: readonly Date[];
  readonly draft?: ProcessDefinition;
  readonly local?: readonly SourceGroup[];
}

/** The Projet's Process as `process` says, in place of the version 1 following it wrote. */
const seedProcess = async (ctx: ScenarioContext, pilotId: string, projectId: string, { versions, draft, local = [] }: ProjectProcess): Promise<void> => {
  const db = ctx.prisma.unscoped;
  if (local.length > 0) await db.artifactSource.updateMany({ where: { projectId, group: { in: [...local] } }, data: { source: 'local' } });
  await db.processVersion.deleteMany({ where: { projectId } });
  for (const [index, activatedAt] of versions.entries()) {
    await db.processVersion.create({
      data: {
        id: newId(),
        pilotId,
        projectId,
        number: index + 1,
        definition: json(PROCESS_CREWDECK),
        sealed: Prisma.DbNull,
        activatedAt,
        activatedBy: index === 0 ? 'creation' : 'pilot',
        templateName: index === 0 ? PROCESS_CREWDECK_NAME : null,
      },
    });
  }
  if (draft === undefined) return;
  await db.processDraft.create({
    data: { id: newId(), pilotId, projectId, definition: json(draft), sealed: Prisma.DbNull, revision: 1, baseVersion: versions.length, updatedAt: new Date() },
  });
};

/** « Site mairie » on « Process Crewdeck », its v3 active since the 4th of November. */
const MAIRIE_VERSIONS = [new Date('2026-10-12T09:00:00.000Z'), new Date('2026-10-27T09:00:00.000Z'), new Date('2026-11-04T09:00:00.000Z')];

/**
 * The Pilote, their Runner on `atelier-pc` online and both Comptes IA, the
 * Review on Claude Code · Opus 5.5 in their Paramètres (as the mockup), and
 * « Site mairie » (GitHub) with `process`.
 */
const mairie = async (ctx: ScenarioContext, process: Omit<ProjectProcess, 'versions'> = {}): Promise<ScenarioSeed> => {
  const { token, pilotId, ...seed } = await withAccounts(ctx);
  await ctx.prisma.unscoped.accountSettings.create({
    data: {
      pilotId,
      roles: { ...DEFAULT_ACCOUNT_SETTINGS.roles, review: { engine: 'claude-code', model: 'claude-opus-5-5' } },
      optionalSteps: DEFAULT_ACCOUNT_SETTINGS.optionalSteps,
    },
  });
  await seedRepositories(ctx, pilotId, [{ name: 'site-mairie', hasCode: true, project: 'Site mairie', projectId: PROCESS_SCENARIO_PROJECTS.mairie }]);
  await seedProcess(ctx, pilotId, PROCESS_SCENARIO_PROJECTS.mairie, { versions: MAIRIE_VERSIONS, ...process });
  return { ...seed, runnerToken: token, runnerMachine: RUNNER_MACHINE };
};

const MAIRIE_PATH = `/projets/${PROCESS_SCENARIO_PROJECTS.mairie}/process`;

/** « Gestion du process » (`design/screens.json`: `process`): « Site mairie », its v3 active, no draft, no Manque. */
export const processScenario = defineScenario({ name: 'process', path: MAIRIE_PATH, seed: (ctx) => mairie(ctx) });

/** A draft with five Manques of four kinds (`process`, state `manques`). */
export const processManques = defineScenario({ name: 'process-manques', path: MAIRIE_PATH, seed: (ctx) => mairie(ctx, { draft: MANQUES_DRAFT }) });

/** Its Review chosen (`process`, state `etape`): its Entrées and Sorties, its Retour, its Outils. */
export const processEtape = defineScenario({ name: 'process-etape', path: `${MAIRIE_PATH}?etape=st-review`, seed: (ctx) => mairie(ctx) });

/** Its Sources (`process`, state `sources`): the Tickets Local, the code and the documents on GitHub. */
export const processSources = defineScenario({
  name: 'process-sources',
  path: `${MAIRIE_PATH}?onglet=sources`,
  seed: (ctx) => mairie(ctx, { local: ['ticket'] }),
});

/**
 * A Local Projet (`process`, state `local`): « Recettes », both groups
 * Local, its v1 active and a draft adding the Phase « Livraison » and its
 * Commande « Lancer », chosen. No Local Projet without a repository yet
 * (PROJET-6): it follows one, its Sources are what makes it Local here.
 */
export const processLocal = defineScenario({
  name: 'process-local',
  path: `/projets/${PROCESS_SCENARIO_PROJECTS.recettes}/process?etape=st-lancer`,
  seed: async (ctx) => {
    const { token, pilotId, ...seed } = await withAccounts(ctx);
    await seedRepositories(ctx, pilotId, [{ name: 'recettes', hasCode: true, project: 'Recettes', projectId: PROCESS_SCENARIO_PROJECTS.recettes }]);
    await seedProcess(ctx, pilotId, PROCESS_SCENARIO_PROJECTS.recettes, {
      versions: [new Date('2026-11-02T09:00:00.000Z')],
      draft: LOCAL_DRAFT,
      local: ['ticket', 'code'],
    });
    return { ...seed, runnerToken: token, runnerMachine: RUNNER_MACHINE };
  },
});

/** A Local Projet with only its creation's draft: no active version yet, the Banner says so. */
export const processSansVersion = defineScenario({
  name: 'process-sans-version',
  path: `/projets/${PROCESS_SCENARIO_PROJECTS.sansVersion}/process`,
  seed: async (ctx) => {
    const { token, pilotId, ...seed } = await withAccounts(ctx);
    await seedRepositories(ctx, pilotId, [{ name: 'carnet', hasCode: false, project: 'Carnet', projectId: PROCESS_SCENARIO_PROJECTS.sansVersion }]);
    await seedProcess(ctx, pilotId, PROCESS_SCENARIO_PROJECTS.sansVersion, { versions: [], draft: crewdeck(), local: ['ticket', 'code'] });
    return { ...seed, runnerToken: token, runnerMachine: RUNNER_MACHINE };
  },
});

export const processScenarios = [processScenario, processManques, processEtape, processSources, processLocal, processSansVersion];
