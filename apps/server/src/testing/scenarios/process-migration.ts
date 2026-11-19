import type { SourceMigrationWaitingItem } from '@crewdeck/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { newId } from '../../ids.js';
import { sealTestItem } from '../test-vault.js';
import { defineScenario, type ScenarioContext, type ScenarioSeed } from './define.js';
import { MAIRIE_PATH, mairie, PROCESS_SCENARIO_PROJECTS } from './process.js';

/** The Tickets of « Site mairie » in its `tickets/` folder, as the mockup counts them. */
const TICKETS = 30;
/** Those in progress, which a migration lets finish on Local: #12 and #14, as the mockup names them. */
const RUNNING = [12, 14] as const;
const MINUTE = 60_000;

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

/**
 * « Site mairie » with its Tickets Local, the code on GitHub (`process-sources`):
 * its 30 Tickets in `tickets/`, and #12 and #14 in « Développement », their
 * PhaseRuns running on the active version. No StepRun: nothing for the
 * engine or the fake Runner to move, so the migration drains as long as the
 * scenario lasts.
 */
const seedMairie = async (ctx: ScenarioContext): Promise<ScenarioSeed & { pilotId: string }> => {
  const seed = await mairie(ctx, { local: ['ticket'] });
  const db = ctx.prisma.unscoped;
  const projectId = PROCESS_SCENARIO_PROJECTS.mairie;
  const { pilotId } = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { pilotId: true } });
  const version = await db.processVersion.findFirstOrThrow({ where: { projectId }, orderBy: { number: 'desc' }, select: { id: true } });
  const now = Date.now();
  const tickets = [];
  for (let number = 1; number <= TICKETS; number += 1) {
    const id = newId();
    const at = new Date(now - (TICKETS - number + 1) * 60 * MINUTE);
    tickets.push({
      id,
      pilotId,
      projectId,
      source: 'local' as const,
      number,
      title: null,
      titleSealed: json(await sealTestItem(`Ticket ${number}`, `ticket:${id}:title`)),
      state: 'open' as const,
      readyMark: false,
      ready: false,
      labels: [],
      branchPrefix: 'feat' as const,
      visualReview: false,
      sourceCreatedAt: at,
      sourceUpdatedAt: at,
    });
  }
  await db.ticket.createMany({ data: tickets });
  await db.phaseRun.createMany({
    data: RUNNING.map((number, index) => ({
      id: newId(),
      pilotId,
      projectId,
      processVersionId: version.id,
      phaseId: 'ph-dev',
      itemType: 'ticket',
      itemId: String(number),
      state: 'running' as const,
      waitingOn: null,
      startedAt: new Date(now - (40 - index * 10) * MINUTE),
      loopBacks: json([]),
    })),
  });
  return { ...seed, pilotId };
};

const SOURCES_PATH = `${MAIRIE_PATH}?onglet=sources`;

/**
 * « Changer la Source d’un Type d’artefact » (`process`, state
 * `migration-source`): the Sources of `seedMairie`, whose Tickets' Select
 * the Pilote turns to GitHub; the core's confirmation over it.
 */
export const processMigrationSource = defineScenario({
  name: 'process-migration-source',
  path: SOURCES_PATH,
  seed: async (ctx) => {
    const { pilotId: _pilotId, ...seed } = await seedMairie(ctx);
    return seed;
  },
});

/**
 * « Migration de Source en cours » (`process`, state `migration-en-cours`):
 * the Tickets' migration to GitHub confirmed ten minutes ago, draining, #12
 * and #14 left to finish on Local.
 */
export const processMigrationEnCours = defineScenario({
  name: 'process-migration-en-cours',
  path: SOURCES_PATH,
  seed: async (ctx) => {
    const { pilotId, ...seed } = await seedMairie(ctx);
    const waitingItems: SourceMigrationWaitingItem[] = RUNNING.map((number) => ({ itemType: 'ticket', number }));
    await ctx.prisma.unscoped.sourceMigration.create({
      data: {
        id: newId(),
        pilotId,
        projectId: PROCESS_SCENARIO_PROJECTS.mairie,
        group: 'ticket',
        from: 'local',
        to: 'github',
        state: 'draining',
        waitingItems: json(waitingItems),
        createdAt: new Date(Date.now() - 10 * MINUTE),
      },
    });
    return seed;
  },
});

export const processMigrationScenarios = [processMigrationSource, processMigrationEnCours];
