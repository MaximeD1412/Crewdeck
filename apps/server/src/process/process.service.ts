import {
  type ActivateProcessInput,
  BUILTIN_TEMPLATES,
  diffDefinitions,
  findGaps,
  PROCESS_CREWDECK_NAME,
  type ProcessDraftInput,
  type ProcessRunningWork,
  processSourcesOf,
  type ProjectProcess,
  type SealedItem,
  UNFINISHED_PHASE_RUN_STATES,
  validateDefinition,
  zId,
} from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { conflict, notFound, unprocessable } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { Prisma } from '../generated/prisma/client.js';
import { newId } from '../ids.js';
import { EventsWriter } from '../realtime/events.writer.js';
import { Transactions, type Tx } from '../realtime/transactions.js';
import { currentPilotId } from '../scope/scope.context.js';
import { SensitiveActionsService } from '../sensitive-actions/sensitive-actions.service.js';
import { PROCESS_DRAFT_VIEW, PROCESS_VERSION_VIEW, type ProcessVersionRow, RUNNING_WORK_VIEW, toProjectProcess, toRunningWork } from './process.view.js';
import { readProjectProcessSources, readSourceRows } from './sources/sources.service.js';
import { toProcessSources } from './sources/sources.view.js';
import { readTemplateCopy, type TemplateCopy } from './templates/process-templates.service.js';

/**
 * The Modèle a new Projet copies: a Modèle of the release (« Process
 * Crewdeck »), or one of the Pilote's own by its id with its sealed part
 * re-sealed by the page under `process:<projectId>` (PROCESS-14).
 */
export type InitialProcess = { readonly template: keyof typeof BUILTIN_TEMPLATES } | { readonly template: string; readonly sealed: SealedItem | null };

/** The names of the built-in Modèles, as the version keeps them. */
const TEMPLATE_NAMES: Readonly<Record<keyof typeof BUILTIN_TEMPLATES, string>> = { 'process-crewdeck': PROCESS_CREWDECK_NAME };

/** The part of a transaction the Process reads and writes; its view holds the Projet's Sources and its work running. */
export type ProcessTx = Pick<Tx, 'project' | 'processVersion' | 'processDraft' | 'artifactSource' | 'phaseRun' | 'ticket'>;

const isBuiltin = (template: string): template is keyof typeof BUILTIN_TEMPLATES => Object.hasOwn(BUILTIN_TEMPLATES, template);

/** What a new Projet copies of the Modèle `from` names, read in the Pilote's scope (`tx`). */
const copyOf = (tx: Tx, from: InitialProcess): Promise<TemplateCopy> | TemplateCopy =>
  isBuiltin(from.template)
    ? { name: TEMPLATE_NAMES[from.template], definition: BUILTIN_TEMPLATES[from.template], sealed: null }
    : readTemplateCopy(tx, from.template, 'sealed' in from ? from.sealed : null);

const json = (value: SealedItem | null): typeof Prisma.DbNull | Prisma.InputJsonValue => (value === null ? Prisma.DbNull : (value as unknown as Prisma.InputJsonValue));

const projectNotFound = () => notFound('project.not-found', MESSAGES['project.not-found']);
const stale = () => conflict('process.draft-stale', MESSAGES['process.draft-stale']);

/** The fields of a refusal: each target with its first label. */
const fieldsOf = (refusals: readonly { target: string; label: string }[]): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const refusal of refusals) fields[refusal.target] ??= refusal.label;
  return fields;
};

/**
 * The PhaseRuns at work (`running` or `waiting`) of the Pilote's Projets
 * (scoped by `tx`), or of one, oldest first, by Projet: each with its
 * version's number, a Ticket's with its number.
 */
export const readRunningWork = async (tx: Pick<Tx, 'phaseRun' | 'ticket'>, projectId?: string): Promise<Map<string, ProcessRunningWork[]>> => {
  const rows = await tx.phaseRun.findMany({
    where: { projectId: projectId ?? { not: null }, state: { in: [...UNFINISHED_PHASE_RUN_STATES] } },
    select: RUNNING_WORK_VIEW,
    orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
  });
  // A Ticket's item is its id; one that is not (a test's « 42 ») has no number.
  const ticketIds = [...new Set(rows.filter((row) => row.itemType === 'ticket' && zId.safeParse(row.itemId).success).map((row) => row.itemId))];
  const tickets = ticketIds.length === 0 ? [] : await tx.ticket.findMany({ where: { id: { in: ticketIds } }, select: { id: true, number: true } });
  const numbers = new Map(tickets.map((ticket) => [ticket.id, ticket.number]));
  const byProject = new Map<string, ProcessRunningWork[]>();
  for (const row of rows) {
    if (row.projectId === null) continue;
    byProject.set(row.projectId, [...(byProject.get(row.projectId) ?? []), ...toRunningWork(row, numbers)]);
  }
  return byProject;
};

/** A Projet's whole Process, in the current Pilote's scope: its highest version, its draft, its Sources and its work running. */
export const readProjectProcess = async (tx: ProcessTx, projectId: string): Promise<ProjectProcess> => {
  const [version, draft, sources, running] = await Promise.all([
    tx.processVersion.findFirst({ where: { projectId }, orderBy: { number: 'desc' }, select: PROCESS_VERSION_VIEW }),
    tx.processDraft.findUnique({ where: { projectId }, select: PROCESS_DRAFT_VIEW }),
    readProjectProcessSources(tx, projectId),
    readRunningWork(tx, projectId),
  ]);
  return toProjectProcess(projectId, version, draft, sources, running.get(projectId) ?? []);
};

/**
 * Writes the Projet's whole Process as `process.upserted`, in `tx` (ADR
 * 0007); its draft keeps the event's `seq`, which `process.activate` is
 * checked against.
 */
export const publishProcess = async (tx: Tx, events: EventsWriter, pilotId: string, projectId: string): Promise<ProjectProcess> => {
  const view = await readProjectProcess(tx, projectId);
  const seq = await events.write(tx, pilotId, 'process.upserted', view);
  if (view.draft) await tx.processDraft.update({ where: { projectId }, data: { lastSeq: seq }, select: { id: true } });
  return view;
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
    private readonly sensitive: SensitiveActionsService,
  ) {}

  /**
   * The Process of a Projet just created, in its transaction, after its
   * Sources (`SourcesService.createDefaults`): version 1, a copy of the
   * Modèle (its sealed part the page re-sealed for the Projet), when it has
   * no Manque on those Sources;
   * otherwise no version and a draft of that copy (`baseVersion: 0`), which
   * the Pilote fixes and activates (PROCESS-10). The Manques never forbid
   * creating a Projet. 404 `process-template.not-found` for an own Modèle
   * gone, 422 `process-template.sealed-mismatch` for its sealed part.
   */
  async createInitialVersion(tx: Tx, projectId: string, from: InitialProcess): Promise<ProjectProcess> {
    const pilotId = currentPilotId();
    const { name, definition, sealed } = await copyOf(tx, from);
    const value = definition as unknown as Prisma.InputJsonValue;
    const now = new Date();
    const sources = toProcessSources(await readSourceRows(tx, projectId));
    if (findGaps(definition, sources).length === 0) {
      await tx.processVersion.create({
        data: { id: newId(), pilotId, projectId, number: 1, definition: value, sealed: json(sealed), activatedAt: now, activatedBy: 'creation', templateName: name },
        select: { id: true },
      });
    } else {
      await tx.processDraft.create({
        data: { id: newId(), pilotId, projectId, definition: value, sealed: json(sealed), revision: 1, baseVersion: 0, updatedAt: now },
        select: { id: true },
      });
    }
    return publishProcess(tx, this.events, pilotId, projectId);
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
      if (refusals.length > 0) throw unprocessable('process.invalid', MESSAGES['process.invalid'], fieldsOf(refusals));

      const draft = {
        definition: input.definition as unknown as Prisma.InputJsonValue,
        sealed: json(input.sealed),
        revision: input.revision + 1,
        baseVersion: input.baseVersion,
        updatedAt: new Date(),
      };
      await tx.processDraft.upsert({ where: { projectId }, create: { id: newId(), pilotId, projectId, ...draft }, update: draft, select: { id: true } });
      return publishProcess(tx, this.events, pilotId, projectId);
    });
  }

  /**
   * `POST /api/projects/:id/process/activate`, the Action sensible
   * `process.activate` (ADR 0011): the Projet's row locked so that two
   * activations at once are ordered, the second finding no draft. 404
   * `project.not-found`; 409 `process.no-draft`, `process.draft-stale` for
   * another `revision` than the one confirmed, `sensitive-action.stale` for a
   * change since the dialog's `seq`; 422 `process.invalid`, `process.has-gaps`
   * (the same `findGaps` as the page, on the Projet's Sources),
   * `process.no-change` when the draft is the active version. Then version
   * n+1 (1 without an active one), the draft deleted and `process.upserted`,
   * in one transaction. A PhaseRun already running keeps its version: the
   * engine pins the active one when a PhaseRun starts.
   */
  activate(projectId: string, { revision, seq }: ActivateProcessInput): Promise<ProjectProcess> {
    const pilotId = currentPilotId();
    return this.transactions.run(async (tx) => {
      await this.events.lock(tx, pilotId);
      const locked = await tx.project.updateMany({ where: { id: projectId }, data: { lastSeq: { increment: 0 } } });
      if (locked.count === 0) throw projectNotFound();

      const row = await tx.processDraft.findUnique({ where: { projectId }, select: { revision: true, lastSeq: true } });
      if (!row) throw conflict('process.no-draft', MESSAGES['process.no-draft']);
      if (row.revision !== revision) throw stale();
      this.sensitive.assertFresh(row.lastSeq, BigInt(seq));

      const { active, draft, ...view } = await readProjectProcess(tx, projectId);
      if (!draft) throw conflict('process.no-draft', MESSAGES['process.no-draft']);
      const refusals = validateDefinition(draft.definition);
      if (refusals.length > 0) throw unprocessable('process.invalid', MESSAGES['process.invalid'], fieldsOf(refusals));
      const gaps = findGaps(draft.definition, processSourcesOf(view));
      if (gaps.length > 0) throw unprocessable('process.has-gaps', MESSAGES['process.has-gaps'], fieldsOf(gaps));
      if (active && diffDefinitions(active.definition, draft.definition).length === 0) {
        throw unprocessable('process.no-change', MESSAGES['process.no-change'].replace('{number}', String(active.number)));
      }

      await tx.processVersion.create({
        data: {
          id: newId(),
          pilotId,
          projectId,
          number: (active?.number ?? 0) + 1,
          definition: draft.definition as unknown as Prisma.InputJsonValue,
          sealed: json(draft.sealed),
          activatedAt: new Date(),
          activatedBy: 'pilot',
          templateName: null,
        },
        select: { id: true },
      });
      await tx.processDraft.delete({ where: { projectId }, select: { id: true } });
      return publishProcess(tx, this.events, pilotId, projectId);
    });
  }
}
