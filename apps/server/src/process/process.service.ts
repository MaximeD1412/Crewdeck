import {
  BUILTIN_TEMPLATES,
  findGaps,
  PROCESS_CREWDECK_NAME,
  type ProcessDraftInput,
  type ProcessSources,
  type ProjectProcess,
  type SealedItem,
  validateDefinition,
} from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { conflict, notFound, unprocessable } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { Prisma } from '../generated/prisma/client.js';
import { newId } from '../ids.js';
import { EventsWriter } from '../realtime/events.writer.js';
import { Transactions, type Tx } from '../realtime/transactions.js';
import { currentPilotId } from '../scope/scope.context.js';
import { PROCESS_DRAFT_VIEW, PROCESS_VERSION_VIEW, type ProcessVersionRow, toProjectProcess } from './process.view.js';

/** The Modèle a new Projet copies: the built-in « Process Crewdeck » until PROCESS-14's Modèles of the Pilote. */
export interface InitialProcess {
  readonly template: keyof typeof BUILTIN_TEMPLATES;
}

/** The names of the built-in Modèles, as the version keeps them. */
const TEMPLATE_NAMES: Readonly<Record<keyof typeof BUILTIN_TEMPLATES, string>> = { 'process-crewdeck': PROCESS_CREWDECK_NAME };

/**
 * The Sources of a Dépôt GitHub followed: both groups on GitHub, until
 * SOURCE-1 stores each Projet's.
 */
export const GITHUB_SOURCES: ProcessSources = { ticket: 'github', code: 'github' };

/** The part of a transaction the Process reads and writes. */
export type ProcessTx = Pick<Tx, 'project' | 'processVersion' | 'processDraft'>;

const json = (value: SealedItem | null): typeof Prisma.DbNull | Prisma.InputJsonValue => (value === null ? Prisma.DbNull : (value as unknown as Prisma.InputJsonValue));

const projectNotFound = () => notFound('project.not-found', MESSAGES['project.not-found']);
const stale = () => conflict('process.draft-stale', MESSAGES['process.draft-stale']);

/** A Projet's whole Process, in the current Pilote's scope: its highest version and its draft. */
export const readProjectProcess = async (tx: ProcessTx, projectId: string): Promise<ProjectProcess> => {
  const [version, draft] = await Promise.all([
    tx.processVersion.findFirst({ where: { projectId }, orderBy: { number: 'desc' }, select: PROCESS_VERSION_VIEW }),
    tx.processDraft.findUnique({ where: { projectId }, select: PROCESS_DRAFT_VIEW }),
  ]);
  return toProjectProcess(projectId, version, draft);
};

/** The active version of each of the Pilote's Projets (scoped by `tx`): each one's highest number. */
export const activeVersions = async (tx: Pick<Tx, 'processVersion'>): Promise<ProcessVersionRow[]> => {
  const highest = await tx.processVersion.groupBy({ by: ['projectId'], _max: { number: true } });
  const wanted = highest.flatMap((row) => (row._max.number === null ? [] : [{ projectId: row.projectId, number: row._max.number }]));
  return wanted.length === 0 ? [] : tx.processVersion.findMany({ where: { OR: wanted }, select: PROCESS_VERSION_VIEW });
};

/**
 * A Projet's Process (ADR 0011): its first version, copied from a Modèle at
 * creation, and its Brouillon, saved whole on every change of the canvas.
 * Every write sends the whole view as `process.upserted`, in its transaction.
 */
@Injectable()
export class ProcessService {
  constructor(
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
  ) {}

  /**
   * The Process of a Projet just created, in its transaction: version 1, a
   * copy of the Modèle, when it has no Manque on the Projet's Sources;
   * otherwise no version and a draft of that copy (`baseVersion: 0`), which
   * the Pilote fixes and activates (PROCESS-10). The Manques never forbid
   * creating a Projet.
   */
  async createInitialVersion(tx: Tx, projectId: string, from: InitialProcess, sources: ProcessSources): Promise<ProjectProcess> {
    const pilotId = currentPilotId();
    const definition = BUILTIN_TEMPLATES[from.template];
    const value = definition as unknown as Prisma.InputJsonValue;
    const now = new Date();
    if (findGaps(definition, sources).length === 0) {
      await tx.processVersion.create({
        data: { id: newId(), pilotId, projectId, number: 1, definition: value, sealed: Prisma.DbNull, activatedAt: now, activatedBy: 'creation', templateName: TEMPLATE_NAMES[from.template] },
        select: { id: true },
      });
    } else {
      await tx.processDraft.create({
        data: { id: newId(), pilotId, projectId, definition: value, sealed: Prisma.DbNull, revision: 1, baseVersion: 0, updatedAt: now },
        select: { id: true },
      });
    }
    const view = await readProjectProcess(tx, projectId);
    await this.events.write(tx, pilotId, 'process.upserted', view);
    return view;
  }

  /**
   * `PUT /api/projects/:id/process/draft`: the Projet's row locked so that
   * two saves at once are ordered; 404 `project.not-found`; 409
   * `process.draft-stale` when the draft was based on another version or
   * another revision (`0` when there is none); 422 `process.invalid` for a
   * refusal of `validateDefinition`, `fields` mapping each target to its
   * label. A draft with Manques is saved: they only forbid activation.
   */
  saveDraft(projectId: string, input: ProcessDraftInput): Promise<ProjectProcess> {
    const pilotId = currentPilotId();
    return this.transactions.run(async (tx) => {
      // The Pilote first, as every writer of an event, then the Projet.
      await this.events.lock(tx, pilotId);
      const locked = await tx.project.updateMany({ where: { id: projectId }, data: { lastSeq: { increment: 0 } } });
      if (locked.count === 0) throw projectNotFound();

      const current = await readProjectProcess(tx, projectId);
      if (input.baseVersion !== (current.active?.number ?? 0)) throw stale();
      if (input.revision !== (current.draft?.revision ?? 0)) throw stale();

      const refusals = validateDefinition(input.definition);
      if (refusals.length > 0) {
        const fields: Record<string, string> = {};
        for (const refusal of refusals) fields[refusal.target] ??= refusal.label;
        throw unprocessable('process.invalid', MESSAGES['process.invalid'], fields);
      }

      const draft = {
        definition: input.definition as unknown as Prisma.InputJsonValue,
        sealed: json(input.sealed),
        revision: input.revision + 1,
        baseVersion: input.baseVersion,
        updatedAt: new Date(),
      };
      await tx.processDraft.upsert({ where: { projectId }, create: { id: newId(), pilotId, projectId, ...draft }, update: draft, select: { id: true } });
      const view = await readProjectProcess(tx, projectId);
      await this.events.write(tx, pilotId, 'process.upserted', view);
      return view;
    });
  }
}
