import {
  type ArtifactType,
  FOR_EACH,
  type ForEach,
  OPEN_STEP_RUN_STATES,
  type PhaseRun,
  type ProcessDefinition,
  type Step,
  type StepKind,
  type StepRun,
  type StepRunInput,
  type StepRunState,
  UNFINISHED_PHASE_RUN_STATES,
  zArtifactRef,
  zProcessDefinition,
} from '@crewdeck/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { newId } from '../../ids.js';
import { EventsWriter } from '../../realtime/events.writer.js';
import type { Tx } from '../../realtime/transactions.js';
import { currentPilotId } from '../../scope/scope.context.js';
import { currentStepRuns, reachedFrom, readySteps, resolveInputs } from './feeding.js';
import { STEP_KIND_HANDLERS, type StepKindHandlers, type StepResult, type StepRunContext } from './kinds/handler.js';
import { PHASE_RUN_VIEW, type PhaseRunRow, STEP_RUN_VIEW, toPhaseRun, toStepRun } from './engine.view.js';

/** A call the engine refuses: a bug of its caller (a Phase that does not exist, an item of another type), never the Pilote's. */
export class EngineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineInputError';
  }
}

/** A second start guard for one `forEach`: a bug of the modules' wiring, thrown at start. */
export class DuplicateStartGuardError extends Error {
  constructor(forEach: ForEach) {
    super(`A start guard of the Phases for ${forEach} is already registered.`);
    this.name = 'DuplicateStartGuardError';
  }
}

/** The item a PhaseRun carries through its Phase: of its `forEach`'s type. */
export interface PhaseItem {
  readonly type: ArtifactType;
  readonly id: string;
}

/** Asked before each StepRun of a PhaseRun of its `forEach` starts; `false` leaves the Étape ready, unstarted, until `startQueued`. */
export type StartGuard = (tx: Tx, request: { projectId: string; phaseRun: PhaseRun; stepId: string; kind: StepKind }) => Promise<boolean>;

/** The failure of an Étape whose kind has no handler yet: until its ticket lands, its StepRun says so. */
export const NO_HANDLER = 'no-handler';

const OPEN: readonly StepRunState[] = OPEN_STEP_RUN_STATES;
const UNFINISHED = [...UNFINISHED_PHASE_RUN_STATES];
const zOutputs = z.array(zArtifactRef);

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

/** A PhaseRun as the engine works on it: its row, its pinned definition and its StepRuns, in the order they were created. */
interface Loaded {
  readonly row: PhaseRunRow;
  readonly phaseRun: PhaseRun;
  readonly definition: ProcessDefinition;
  readonly stepRuns: StepRun[];
}

/**
 * The engine (ADR 0011, « The engine »): it interprets each Projet's pinned
 * version instead of a fixed state machine. A PhaseRun is one item through
 * one Phase, pinned to the version active when it starts; a StepRun is one
 * pass of an Étape, started once every Entrée is fed (`feeding.ts`), its
 * kind's handler doing the work.
 *
 * Every method writes in its caller's transaction, each change with its
 * `phase-run.upserted` or `step-run.upserted`. Those that change a PhaseRun
 * lock the Pilote's row first (as every writer of an event does), then the
 * PhaseRun's: two signals of one PhaseRun are applied one after the other.
 */
@Injectable()
export class Engine {
  private readonly guards = new Map<ForEach, StartGuard>();
  /** The definitions of the versions read, by id: a version is immutable. */
  private readonly definitions = new Map<string, ProcessDefinition>();

  constructor(
    private readonly events: EventsWriter,
    @Inject(STEP_KIND_HANDLERS) private readonly handlers: StepKindHandlers,
  ) {}

  /** For the guard's owner (BOUCLE-2), in its `onModuleInit`: one guard per `forEach`, a second throws. */
  registerStartGuard(forEach: ForEach, guard: StartGuard): void {
    if (this.guards.has(forEach)) throw new DuplicateStartGuardError(forEach);
    this.guards.set(forEach, guard);
  }

  /** The id of the active version's Phase that repeats for `forEach`, `null` when the Projet has no version or no such Phase. */
  async phaseFor(tx: Tx, projectId: string, forEach: ForEach): Promise<string | null> {
    const version = await this.activeVersion(tx, projectId);
    return version?.definition.phases.find((phase) => phase.forEach === forEach)?.id ?? null;
  }

  /**
   * An item enters a Phase: a `running` PhaseRun pinned to the active
   * version, then its first Étapes started. An unfinished PhaseRun of the
   * same item and Phase is returned as is (a double click, a retry). The
   * Phase must exist and repeat for the item's type.
   */
  async admit(tx: Tx, { projectId, phaseId, item }: { projectId: string; phaseId: string; item: PhaseItem }): Promise<PhaseRun> {
    const pilotId = currentPilotId();
    await this.events.lock(tx, pilotId);
    const version = await this.activeVersion(tx, projectId);
    if (!version) throw new EngineInputError(`The Projet ${projectId} has no active version of its Process.`);
    const phase = version.definition.phases.find((candidate) => candidate.id === phaseId);
    if (!phase) throw new EngineInputError(`The version ${version.number} has no Phase ${phaseId}.`);
    if (!phase.forEach || FOR_EACH[phase.forEach].type !== item.type) throw new EngineInputError(`The Phase ${phaseId} does not repeat for ${item.type}.`);

    const unfinished = await tx.phaseRun.findFirst({
      where: { projectId, phaseId, itemType: item.type, itemId: item.id, state: { in: UNFINISHED } },
      select: PHASE_RUN_VIEW,
    });
    if (unfinished) return toPhaseRun(unfinished);

    const row = await tx.phaseRun.create({
      data: { id: newId(), pilotId, projectId, processVersionId: version.id, phaseId, itemType: item.type, itemId: item.id, state: 'running', startedAt: new Date() },
      select: PHASE_RUN_VIEW,
    });
    await this.publishPhaseRun(tx, row);
    return (await this.advanceLoaded(tx, await this.load(tx, row.id))).phaseRun;
  }

  /**
   * The end of a StepRun's thing (a Session, a Décision, a Commande): its
   * kind's `onSignal` says what it means, the result is written, then the
   * PhaseRun advances. `false` when the StepRun is not `running`, `waiting`,
   * `interrupted` or `blocked`, or the handler changed nothing.
   */
  async signal(tx: Tx, stepRunId: string, signal: unknown): Promise<boolean> {
    const found = await tx.stepRun.findUnique({ where: { id: stepRunId }, select: { phaseRunId: true } });
    if (!found) return false;
    const loaded = await this.lockAndLoad(tx, found.phaseRunId);
    const stepRun = loaded.stepRuns.find((run) => run.id === stepRunId);
    if (!stepRun || !OPEN.includes(stepRun.state)) return false;
    const handler = this.handlers.of(stepRun.kind);
    if (!handler) return false;

    const result = await handler.onSignal(tx, this.contextOf(loaded, stepRun), signal);
    if (result === null) return false;
    await this.writeResult(tx, stepRun, result);
    await this.advanceLoaded(tx, await this.load(tx, loaded.row.id));
    return true;
  }

  /**
   * « Relancer l'Étape » (ATOI-2): a `failed` StepRun gets a new StepRun of
   * the same Étape and iteration, on the same inputs, and its PhaseRun is
   * `running` again. `null` when the StepRun is not `failed`, or was retried
   * already. The start guard is not asked: the Étape had started.
   */
  async retry(tx: Tx, stepRunId: string): Promise<StepRun | null> {
    const found = await tx.stepRun.findUnique({ where: { id: stepRunId }, select: { phaseRunId: true } });
    if (!found) return null;
    const loaded = await this.lockAndLoad(tx, found.phaseRunId);
    const failed = loaded.stepRuns.find((run) => run.id === stepRunId);
    if (!failed || failed.state !== 'failed' || loaded.row.state === 'stopped') return null;
    if (!currentStepRuns(loaded.stepRuns).some((run) => run.id === failed.id)) return null;

    if (loaded.row.state !== 'running') await this.setPhaseRunState(tx, loaded.row.id, 'running');
    const reloaded = await this.load(tx, loaded.row.id);
    const started = await this.startStep(tx, reloaded, this.stepOf(reloaded, failed.stepId), failed.inputs, failed.iteration, failed.reason);
    await this.advanceLoaded(tx, await this.load(tx, loaded.row.id));
    return started;
  }

  /** Stops a PhaseRun: each open StepRun through its handler's `stop`, then `stopped`; the PhaseRun `stopped`. A finished one is returned as is. */
  async stop(tx: Tx, phaseRunId: string): Promise<PhaseRun> {
    const loaded = await this.lockAndLoad(tx, phaseRunId);
    if (!(UNFINISHED as string[]).includes(loaded.row.state)) return loaded.phaseRun;
    for (const run of loaded.stepRuns.filter((candidate) => OPEN.includes(candidate.state))) {
      await this.handlers.of(run.kind)?.stop?.(tx, this.contextOf(loaded, run));
      await this.writeStepRun(tx, run.id, { state: 'stopped', endedAt: new Date() });
    }
    return this.setPhaseRunState(tx, phaseRunId, 'stopped');
  }

  /**
   * Undoes `stepId` and every Étape it reaches by arrows inside the Phase:
   * their StepRuns not yet `superseded` are stopped through their handler
   * when they run, then `superseded`; their outputs no longer feed anything.
   * For a rerun: `rerunFrom`'s, a Retour's (PROCESS-6).
   */
  async supersedeFrom(tx: Tx, phaseRun: Pick<PhaseRun, 'id'>, stepId: string): Promise<void> {
    const loaded = await this.lockAndLoad(tx, phaseRun.id);
    this.stepOf(loaded, stepId);
    const undone = new Set(reachedFrom(loaded.definition, stepId));
    for (const run of loaded.stepRuns.filter((candidate) => undone.has(candidate.stepId) && candidate.state !== 'superseded')) {
      if (OPEN.includes(run.state)) await this.handlers.of(run.kind)?.stop?.(tx, this.contextOf(loaded, run));
      await this.writeStepRun(tx, run.id, { state: 'superseded', endedAt: run.endedAt === null ? new Date() : undefined });
    }
  }

  /**
   * Runs `stepId` again: `supersedeFrom`, then a new StepRun of that Étape
   * at the next iteration, `reason` recorded, its inputs resolved again,
   * then the PhaseRun advances and the Étapes after it run on its new
   * outputs. Counts against no Retour: a caller counts its own reruns by
   * `reason` (BOUCLE-4's `fix-conflict`). The PhaseRun must be `running` or
   * `waiting`; it is `running` after.
   */
  async rerunFrom(tx: Tx, phaseRunId: string, stepId: string, { reason }: { reason: string }): Promise<StepRun> {
    const loaded = await this.lockAndLoad(tx, phaseRunId);
    if (!(UNFINISHED as string[]).includes(loaded.row.state)) throw new EngineInputError(`The PhaseRun ${phaseRunId} is ${loaded.row.state}: it cannot rerun an Étape.`);
    const step = this.stepOf(loaded, stepId);
    const iteration = Math.max(0, ...loaded.stepRuns.filter((run) => run.stepId === stepId).map((run) => run.iteration)) + 1;

    await this.supersedeFrom(tx, loaded.phaseRun, stepId);
    if (loaded.row.state !== 'running') await this.setPhaseRunState(tx, phaseRunId, 'running');
    const reloaded = await this.load(tx, phaseRunId);
    const inputs = resolveInputs(reloaded.definition, reloaded.phaseRun, reloaded.stepRuns.filter((run) => run.state !== 'superseded'), step);
    if (inputs === null) throw new EngineInputError(`The Entrées of ${stepId} are not fed: it cannot run again.`);
    const started = await this.startStep(tx, reloaded, step, inputs, iteration, reason);
    await this.advanceLoaded(tx, await this.load(tx, phaseRunId));
    return started;
  }

  /** For the start guard's owner once a slot frees: `advance` of every `running` PhaseRun of the Projet, the oldest first. */
  async startQueued(tx: Tx, projectId: string): Promise<void> {
    await this.events.lock(tx, currentPilotId());
    const running = await tx.phaseRun.findMany({ where: { projectId, state: 'running' }, select: { id: true }, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }] });
    for (const { id } of running) await this.advance(tx, { id });
  }

  /**
   * Starts each ready Étape of a `running` PhaseRun (its StepRun written with
   * its inputs, then its handler's `start`; a kind without a handler makes it
   * `failed`, `no-handler`), then says whether the PhaseRun is over: `done`
   * when no StepRun is open nor `failed` and nothing is ready (an Étape held
   * by the guard is ready), `failed` when one is `failed` and none is open.
   */
  async advance(tx: Tx, phaseRun: Pick<PhaseRun, 'id'>): Promise<PhaseRun> {
    return (await this.advanceLoaded(tx, await this.lockAndLoad(tx, phaseRun.id))).phaseRun;
  }

  private async advanceLoaded(tx: Tx, loaded: Loaded): Promise<Loaded> {
    if (loaded.row.state !== 'running') return loaded;
    const phase = loaded.definition.phases.find((candidate) => candidate.id === loaded.row.phaseId);
    const guard = phase?.forEach ? this.guards.get(phase.forEach) : undefined;
    for (const ready of readySteps(loaded.definition, loaded.phaseRun, loaded.stepRuns)) {
      const step = this.stepOf(loaded, ready.stepId);
      if (guard && !(await guard(tx, { projectId: loaded.row.projectId, phaseRun: loaded.phaseRun, stepId: step.id, kind: step.kind }))) continue;
      const iteration = Math.max(0, ...loaded.stepRuns.filter((run) => run.stepId === step.id).map((run) => run.iteration)) + 1;
      await this.startStep(tx, loaded, step, ready.inputs, iteration, null);
    }

    const after = await this.load(tx, loaded.row.id);
    const current = currentStepRuns(after.stepRuns);
    if (current.some((run) => OPEN.includes(run.state))) return after;
    if (current.some((run) => run.state === 'failed')) {
      await this.setPhaseRunState(tx, after.row.id, 'failed');
      return this.load(tx, after.row.id);
    }
    if (readySteps(after.definition, after.phaseRun, after.stepRuns).length > 0) return after;
    await this.setPhaseRunState(tx, after.row.id, 'done');
    return this.load(tx, after.row.id);
  }

  /** A new StepRun of `step`, `running` while its handler starts it, then the state the handler says. */
  private async startStep(tx: Tx, loaded: Loaded, step: Step, inputs: StepRunInput[], iteration: number, reason: string | null): Promise<StepRun> {
    const handler = this.handlers.of(step.kind);
    const now = new Date();
    const row = await tx.stepRun.create({
      data: {
        id: newId(),
        pilotId: currentPilotId(),
        projectId: loaded.row.projectId,
        phaseRunId: loaded.row.id,
        stepId: step.id,
        kind: step.kind,
        iteration,
        state: handler ? 'running' : 'failed',
        inputs: json(inputs),
        failure: handler ? null : NO_HANDLER,
        reason,
        startedAt: now,
        endedAt: handler ? null : now,
      },
      select: STEP_RUN_VIEW,
    });
    let stepRun = toStepRun(row);
    if (handler) {
      const state = await handler.start(tx, this.contextOf(loaded, stepRun));
      if (state !== 'running') stepRun = toStepRun(await tx.stepRun.update({ where: { id: stepRun.id }, data: { state }, select: STEP_RUN_VIEW }));
    }
    await this.publishStepRun(tx, stepRun);
    return stepRun;
  }

  private async writeResult(tx: Tx, stepRun: StepRun, result: StepResult): Promise<void> {
    switch (result.state) {
      case 'done':
        await this.writeStepRun(tx, stepRun.id, { state: 'done', outputs: json(zOutputs.parse(result.outputs)), verdict: result.verdict ?? null, failure: null, endedAt: new Date() });
        return;
      case 'failed':
        await this.writeStepRun(tx, stepRun.id, { state: 'failed', failure: result.failure, endedAt: new Date() });
        return;
      case 'interrupted':
      case 'blocked':
        await this.writeStepRun(tx, stepRun.id, { state: result.state, failure: result.failure });
        return;
      default:
        await this.writeStepRun(tx, stepRun.id, { state: result.state, failure: null });
    }
  }

  private async writeStepRun(tx: Tx, id: string, data: Prisma.StepRunUpdateInput): Promise<void> {
    await this.publishStepRun(tx, toStepRun(await tx.stepRun.update({ where: { id }, data, select: STEP_RUN_VIEW })));
  }

  private async setPhaseRunState(tx: Tx, id: string, state: 'running' | 'done' | 'stopped' | 'failed'): Promise<PhaseRun> {
    const finished = state !== 'running';
    const row = await tx.phaseRun.update({ where: { id }, data: { state, waitingOn: null, endedAt: finished ? new Date() : null }, select: PHASE_RUN_VIEW });
    return this.publishPhaseRun(tx, row);
  }

  private async publishPhaseRun(tx: Tx, row: PhaseRunRow): Promise<PhaseRun> {
    const view = toPhaseRun(row);
    const seq = await this.events.write(tx, currentPilotId(), 'phase-run.upserted', view);
    await tx.phaseRun.update({ where: { id: row.id }, data: { lastSeq: seq }, select: { id: true } });
    return view;
  }

  private async publishStepRun(tx: Tx, stepRun: StepRun): Promise<void> {
    const seq = await this.events.write(tx, currentPilotId(), 'step-run.upserted', stepRun);
    await tx.stepRun.update({ where: { id: stepRun.id }, data: { lastSeq: seq }, select: { id: true } });
  }

  /** The Pilote's row, then the PhaseRun's, locked until the commit; then the PhaseRun read. */
  private async lockAndLoad(tx: Tx, phaseRunId: string): Promise<Loaded> {
    await this.events.lock(tx, currentPilotId());
    const locked = await tx.phaseRun.updateMany({ where: { id: phaseRunId }, data: { lastSeq: { increment: 0 } } });
    if (locked.count === 0) throw new EngineInputError(`No PhaseRun ${phaseRunId}.`);
    return this.load(tx, phaseRunId);
  }

  private async load(tx: Tx, phaseRunId: string): Promise<Loaded> {
    const row = await tx.phaseRun.findUnique({ where: { id: phaseRunId }, select: PHASE_RUN_VIEW });
    if (!row) throw new EngineInputError(`No PhaseRun ${phaseRunId}.`);
    const [definition, stepRuns] = await Promise.all([
      this.definitionOf(tx, row.processVersionId),
      tx.stepRun.findMany({ where: { phaseRunId }, select: STEP_RUN_VIEW, orderBy: { id: 'asc' } }),
    ]);
    return { row, phaseRun: toPhaseRun(row), definition, stepRuns: stepRuns.map(toStepRun) };
  }

  private async definitionOf(tx: Tx, processVersionId: string): Promise<ProcessDefinition> {
    const cached = this.definitions.get(processVersionId);
    if (cached) return cached;
    const version = await tx.processVersion.findUniqueOrThrow({ where: { id: processVersionId }, select: { definition: true } });
    const definition = zProcessDefinition.parse(version.definition);
    this.definitions.set(processVersionId, definition);
    return definition;
  }

  /** The Projet's active version: its highest number. */
  private async activeVersion(tx: Tx, projectId: string): Promise<{ id: string; number: number; definition: ProcessDefinition } | null> {
    const version = await tx.processVersion.findFirst({ where: { projectId }, orderBy: { number: 'desc' }, select: { id: true, number: true } });
    return version ? { ...version, definition: await this.definitionOf(tx, version.id) } : null;
  }

  private stepOf(loaded: Loaded, stepId: string): Step {
    const step = loaded.definition.steps.find((candidate) => candidate.id === stepId && candidate.phaseId === loaded.row.phaseId);
    if (!step) throw new EngineInputError(`The Phase ${loaded.row.phaseId} of version ${loaded.phaseRun.processVersion} has no Étape ${stepId}.`);
    return step;
  }

  private contextOf(loaded: Loaded, stepRun: StepRun): StepRunContext {
    return { phaseRun: loaded.phaseRun, stepRun, step: this.stepOf(loaded, stepRun.stepId), definition: loaded.definition };
  }
}
