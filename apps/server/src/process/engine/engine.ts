import {
  type ArtifactType,
  BUILTIN_TEMPLATES,
  type BuiltinTemplateId,
  DECISION_LABEL_MAX,
  DECISION_META_PART_MAX,
  FOR_EACH,
  type ForEach,
  type LoopBack,
  loopBackFrom,
  OPEN_STEP_RUN_STATES,
  type PhaseRun,
  type PhaseRunLoopBack,
  type ProcessDefinition,
  type Step,
  type StepKind,
  type StepRun,
  type StepRunInput,
  type StepRunState,
  UNFINISHED_PHASE_RUN_STATES,
  zArtifactRef,
  zBuiltinTemplateId,
  zProcessDefinition,
} from '@crewdeck/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DecisionsService } from '../../decisions/decisions.service.js';
import { unprocessable } from '../../errors/app-error.js';
import { MESSAGES } from '../../errors/messages.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { newId } from '../../ids.js';
import { EventsWriter } from '../../realtime/events.writer.js';
import type { Tx } from '../../realtime/transactions.js';
import { currentPilotId } from '../../scope/scope.context.js';
import { type Ancestor, crossingArrows, currentStepRuns, isFirstEntry, reachedFrom, readySteps, resolveInputs } from './feeding.js';
import { PHASE_ITEMS, type PhaseItemHandlers } from './items.js';
import { ancestors, findParent } from './lineage.js';
import { type AfterChanges, afterChanges, countTaken, withExtraPass } from './loop-backs.js';
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
export type StartGuard = (tx: Tx, request: { projectId: string | null; phaseRun: PhaseRun; stepId: string; kind: StepKind }) => Promise<boolean>;

/** The `reason` of a StepRun a Retour started. */
export const LOOP_BACK = 'loop-back';

/** The failure of an Étape whose kind has no handler yet: until its ticket lands, its StepRun says so. */
export const NO_HANDLER = 'no-handler';

const OPEN: readonly StepRunState[] = OPEN_STEP_RUN_STATES;
const UNFINISHED = [...UNFINISHED_PHASE_RUN_STATES];
/** The PhaseRuns of a Phase without `forEach` that hold its turn in the Projet (a `waiting` one but on `queue`): a `failed` one until `retry` or `stop`. */
const HOLDING = ['running', 'waiting', 'failed'] as const;

/** What an Idée noted without a Projet runs on (US-5): the « idea.noted » Phase of the release's « Process Crewdeck ». */
const WITHOUT_PROJECT: BuiltinTemplateId = 'process-crewdeck';
const zOutputs = z.array(zArtifactRef);

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

/**
 * The starts `retry` and `rerunFrom` asked, by Étape, until the Étape's
 * StepRun is written: with the iteration and the reason it starts with, and
 * for a retry the `failed` StepRun it replaces. The start guard may hold
 * them; `startQueued` then starts them as it does any ready Étape.
 */
const zPendingStarts = z.record(z.string(), z.object({ iteration: z.number().int().min(1), reason: z.string().nullable(), retryOf: z.string().optional() }));
type PendingStarts = z.infer<typeof zPendingStarts>;

/** What `retry` and `rerunFrom` give: the new StepRun, or `held` while the start guard refuses it (`startQueued` starts it later). */
export type Restart = StepRun | 'held';

/**
 * A PhaseRun as the engine works on it: its row, its pinned definition, its
 * StepRuns in the order they were created, its pending starts, `live`: its
 * StepRuns but the `failed` ones of an Étape whose retry is pending, so that
 * this Étape is ready again, and its lineage's PhaseRuns, nearest first.
 */
interface Loaded {
  readonly row: PhaseRunRow;
  readonly phaseRun: PhaseRun;
  readonly definition: ProcessDefinition;
  readonly stepRuns: StepRun[];
  readonly pending: PendingStarts;
  readonly live: StepRun[];
  readonly ancestors: Ancestor[];
}

/** A definition a new PhaseRun is pinned to: a Projet's version, or a builtin one without a Projet. */
type Pin = { readonly version: { id: string; number: number }; readonly builtinTemplate: null } | { readonly version: null; readonly builtinTemplate: BuiltinTemplateId };

const nextIteration = (stepRuns: readonly StepRun[], stepId: string): number =>
  Math.max(0, ...stepRuns.filter((run) => run.stepId === stepId).map((run) => run.iteration)) + 1;

/**
 * The engine (ADR 0011, « The engine »): it interprets each Projet's pinned
 * version instead of a fixed state machine. A PhaseRun is one item through
 * one Phase, pinned to the version active when it starts; a StepRun is one
 * pass of an Étape, started once every Entrée is fed (`feeding.ts`), its
 * kind's handler doing the work.
 *
 * Across Phases (PROCESS-5): each PhaseRun records its parent, the PhaseRun
 * whose output became its item (`lineage.ts`), and an Entrée fed from another
 * Phase reads its ancestors' outputs. A `done` StepRun carries its outputs
 * along its arrows to other Phases: into an `idea.noted` Phase it admits
 * them; into a Phase without `forEach`, it starts a PhaseRun of that Phase,
 * one at a time per Projet, in order (`waiting` on `queue` for its turn).
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
    private readonly decisions: DecisionsService,
    @Inject(STEP_KIND_HANDLERS) private readonly handlers: StepKindHandlers,
    @Inject(PHASE_ITEMS) private readonly items: PhaseItemHandlers,
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
   * same item and Phase is returned as is (a double click, a retry), whatever
   * the active version became since. Otherwise the active version's Phase
   * must exist and repeat for the item's type.
   *
   * Its parent is `parentPhaseRunId` when given (a Ticket drafted from an
   * Idée), else the PhaseRun that gave the item (`findParent`: the
   * Conception whose Découpage wrote the Ticket), else none (a Ticket
   * written by hand). Without a Projet, only an Idée enters, into the
   * `idea.noted` Phase of the release's « Process Crewdeck », the PhaseRun on
   * that definition with no version; any other is `EngineInputError`.
   */
  async admit(
    tx: Tx,
    { projectId, phaseId, item, parentPhaseRunId }: { projectId: string | null; phaseId: string; item: PhaseItem; parentPhaseRunId?: string },
  ): Promise<PhaseRun> {
    const pilotId = currentPilotId();
    await this.events.lock(tx, pilotId);
    const builtinTemplate = projectId === null ? WITHOUT_PROJECT : null;
    const unfinished = await tx.phaseRun.findFirst({
      where: { projectId, builtinTemplate, phaseId, itemType: item.type, itemId: item.id, state: { in: UNFINISHED } },
      select: PHASE_RUN_VIEW,
    });
    if (unfinished) return toPhaseRun(unfinished);

    const { pin, definition } = await this.pinFor(tx, projectId);
    const phase = definition.phases.find((candidate) => candidate.id === phaseId);
    if (!phase) throw new EngineInputError(`The ${pin.version ? `version ${pin.version.number}` : pin.builtinTemplate} has no Phase ${phaseId}.`);
    if (!phase.forEach || FOR_EACH[phase.forEach].type !== item.type) throw new EngineInputError(`The Phase ${phaseId} does not repeat for ${item.type}.`);
    if (projectId === null && phase.forEach !== 'idea.noted') throw new EngineInputError(`Without a Projet, only a noted Idée enters a Phase: not ${phaseId}.`);

    const parent = parentPhaseRunId ?? (await findParent(tx, projectId, item));
    const row = await tx.phaseRun.create({
      data: {
        id: newId(),
        pilotId,
        projectId,
        processVersionId: pin.version?.id ?? null,
        builtinTemplate: pin.builtinTemplate,
        parentPhaseRunId: parent,
        phaseId,
        itemType: item.type,
        itemId: item.id,
        state: 'running',
        startedAt: new Date(),
      },
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
   *
   * A `done` result with the Verdict « changements » (ADR 0011, « A
   * Retour »): the Retour the Étape leaves is taken while the PhaseRun took
   * it fewer times than its maximum (and the passes the Pilote allowed
   * beyond), the work running again from its target; once it is reached, or
   * when no Retour leaves the Étape, the PhaseRun waits on the Décision
   * `loop-back.exhausted`. A gate without a Retour cannot ask for changes:
   * 422 `step-run.no-loop-back`, nothing written. While the PhaseRun waits
   * on that Décision, a « changements » is only recorded: the Pilote's answer
   * says what follows. A « changements » carries nothing to other Phases.
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
    const changes = result.state === 'done' && result.verdict === 'changes' ? afterChanges(loaded.definition, loaded.phaseRun.loopBacks, stepRun.stepId) : null;
    if (changes?.move === 'refused') throw unprocessable('step-run.no-loop-back', MESSAGES['step-run.no-loop-back']);
    await this.writeResult(tx, loaded.definition, stepRun, result);
    if (changes && loaded.row.state === 'running') await this.onChanges(tx, await this.load(tx, loaded.row.id), stepRunId, changes);
    const after = await this.advanceLoaded(tx, await this.load(tx, loaded.row.id));
    const done = after.stepRuns.find((run) => run.id === stepRunId);
    if (done?.state === 'done' && done.verdict !== 'changes') await this.carry(tx, after, done);
    return true;
  }

  /**
   * « Encore un passage » (the Décision `loop-back.exhausted`): the Retour
   * leaving the Étape of `stepRunId`, whose « changements » raised it, is
   * allowed one more pass and taken at once; the Décision resolved
   * `one-more-pass`, the PhaseRun `running`. `null`, nothing written, when
   * the PhaseRun does not wait on that Décision or no Retour leaves the Étape.
   */
  async oneMorePass(tx: Tx, phaseRunId: string, stepRunId: string): Promise<PhaseRun | null> {
    const loaded = await this.lockAndLoad(tx, phaseRunId);
    if (loaded.row.state !== 'waiting' || loaded.row.waitingOn !== 'decision') return null;
    const judged = loaded.stepRuns.find((run) => run.id === stepRunId);
    const loopBack = judged ? loopBackFrom(loaded.definition, judged.stepId) : null;
    if (!loopBack) return null;
    await this.takeLoopBack(tx, loaded, loopBack, withExtraPass(loaded.phaseRun.loopBacks, loopBack));
    await this.decisions.resolve(tx, 'loop-back.exhausted', phaseRunId, 'one-more-pass');
    return (await this.advanceLoaded(tx, await this.load(tx, phaseRunId))).phaseRun;
  }

  /**
   * « Relancer l'Étape » (ATOI-2): a `failed` StepRun gets a new StepRun of
   * the same Étape and iteration, on the same inputs, and its PhaseRun is
   * `running` again; the `failed` one stays, for the history. The start
   * guard is asked as for any start: `held` while it refuses, the Étape
   * ready until `startQueued`. `null`, nothing written, when the StepRun is
   * not the current `failed` one of its Étape, its retry is already asked,
   * its PhaseRun is `stopped` or `done`, or the item already went through
   * the Phase again (a later admission: one unfinished PhaseRun per item and
   * Phase).
   */
  async retry(tx: Tx, stepRunId: string): Promise<Restart | null> {
    const found = await tx.stepRun.findUnique({ where: { id: stepRunId }, select: { phaseRunId: true } });
    if (!found) return null;
    const loaded = await this.lockAndLoad(tx, found.phaseRunId);
    const failed = loaded.stepRuns.find((run) => run.id === stepRunId);
    if (!failed || failed.state !== 'failed' || loaded.row.state === 'stopped' || loaded.row.state === 'done') return null;
    if (loaded.pending[failed.stepId] || !currentStepRuns(loaded.live).some((run) => run.id === failed.id)) return null;
    if (loaded.row.state === 'failed' && (await this.anotherUnfinished(tx, loaded.row))) return null;

    await this.writePending(tx, loaded.row.id, { ...loaded.pending, [failed.stepId]: { iteration: failed.iteration, reason: failed.reason, retryOf: failed.id } });
    if (loaded.row.state !== 'running') await this.reopen(tx, loaded);
    const after = await this.advanceLoaded(tx, await this.load(tx, loaded.row.id));
    return this.restarted(after, failed.stepId, failed.id);
  }

  /**
   * Stops a PhaseRun, unfinished or `failed`: each open StepRun through its
   * handler's `stop`, then `stopped`; the PhaseRun `stopped`, its Décision
   * `loop-back.exhausted` resolved `stopped` when it waited on it, and the
   * turn of its Phase passes when it has no `forEach`. A `done` or `stopped`
   * one is returned as is.
   */
  async stop(tx: Tx, phaseRunId: string): Promise<PhaseRun> {
    const loaded = await this.lockAndLoad(tx, phaseRunId);
    if (loaded.row.state === 'done' || loaded.row.state === 'stopped') return loaded.phaseRun;
    for (const run of loaded.stepRuns.filter((candidate) => OPEN.includes(candidate.state))) {
      await this.handlers.of(run.kind)?.stop?.(tx, this.contextOf(loaded, run));
      await this.writeStepRun(tx, loaded.definition, run.id, { state: 'stopped', endedAt: new Date() });
    }
    if (Object.keys(loaded.pending).length > 0) await this.writePending(tx, phaseRunId, {});
    const stopped = await this.setPhaseRunState(tx, phaseRunId, 'stopped');
    if (loaded.row.waitingOn === 'decision') await this.decisions.resolve(tx, 'loop-back.exhausted', phaseRunId, 'stopped');
    await this.passTurn(tx, loaded);
    return stopped;
  }

  /**
   * Undoes `stepId` and every Étape it reaches by arrows inside the Phase:
   * their StepRuns not yet `superseded` are stopped through their handler
   * when they run, then `superseded`; their outputs no longer feed anything,
   * and a start pending for them is dropped. For a rerun: `rerunFrom`'s, a
   * Retour's (PROCESS-6).
   */
  async supersedeFrom(tx: Tx, phaseRun: Pick<PhaseRun, 'id'>, stepId: string): Promise<void> {
    const loaded = await this.lockAndLoad(tx, phaseRun.id);
    this.stepOf(loaded, stepId);
    const undone = new Set(reachedFrom(loaded.definition, stepId));
    for (const run of loaded.stepRuns.filter((candidate) => undone.has(candidate.stepId) && candidate.state !== 'superseded')) {
      if (OPEN.includes(run.state)) await this.handlers.of(run.kind)?.stop?.(tx, this.contextOf(loaded, run));
      await this.writeStepRun(tx, loaded.definition, run.id, { state: 'superseded', endedAt: run.endedAt === null ? new Date() : undefined });
    }
    const kept = Object.fromEntries(Object.entries(loaded.pending).filter(([pendingStep]) => !undone.has(pendingStep)));
    if (Object.keys(kept).length !== Object.keys(loaded.pending).length) await this.writePending(tx, phaseRun.id, kept);
  }

  /**
   * Runs `stepId` again: `supersedeFrom`, then a new StepRun of that Étape
   * at the next iteration, `reason` recorded, its inputs resolved again,
   * then the PhaseRun advances and the Étapes after it run on its new
   * outputs. Counts against no Retour: a caller counts its own reruns by
   * `reason` (BOUCLE-4's `fix-conflict`). The start guard is asked as for
   * any start: `held` while it refuses, the Étape ready with its iteration
   * and reason until `startQueued`. The PhaseRun must be `running` or
   * `waiting`, but not on `queue` (a Phase without `forEach` runs one at a
   * time: its turn comes through `passTurn` only), and the Étape's Entrées
   * fed without what it undoes (else `EngineInputError`, nothing written);
   * it is `running` after.
   */
  async rerunFrom(tx: Tx, phaseRunId: string, stepId: string, { reason }: { reason: string }): Promise<Restart> {
    const loaded = await this.lockAndLoad(tx, phaseRunId);
    if (!(UNFINISHED as string[]).includes(loaded.row.state)) throw new EngineInputError(`The PhaseRun ${phaseRunId} is ${loaded.row.state}: it cannot rerun an Étape.`);
    if (loaded.row.waitingOn === 'queue') throw new EngineInputError(`The PhaseRun ${phaseRunId} waits for its turn in its Phase: it cannot rerun an Étape before it starts.`);
    const step = this.stepOf(loaded, stepId);
    const undone = new Set(reachedFrom(loaded.definition, stepId));
    const kept = loaded.live.filter((run) => run.state !== 'superseded' && !undone.has(run.stepId));
    if (resolveInputs(loaded.definition, loaded.phaseRun, kept, step, loaded.ancestors) === null) throw new EngineInputError(`The Entrées of ${stepId} are not fed: it cannot run again.`);

    const since = await this.supersedeAndAsk(tx, loaded, stepId, reason);
    if (loaded.row.state !== 'running') await this.setPhaseRunState(tx, phaseRunId, 'running');
    const after = await this.advanceLoaded(tx, await this.load(tx, phaseRunId));
    return this.restarted(after, stepId, since);
  }

  /**
   * `supersedeFrom(stepId)`, then a start of `stepId` asked at its next
   * iteration with `reason`, which `advance` writes (or holds, for the start
   * guard). Returns the id of the PhaseRun's last StepRun before it.
   */
  private async supersedeAndAsk(tx: Tx, loaded: Loaded, stepId: string, reason: string): Promise<string> {
    const iteration = nextIteration(loaded.stepRuns, stepId);
    await this.supersedeFrom(tx, loaded.phaseRun, stepId);
    const superseded = await this.load(tx, loaded.row.id);
    await this.writePending(tx, loaded.row.id, { ...superseded.pending, [stepId]: { iteration, reason } });
    return superseded.stepRuns.at(-1)?.id ?? '';
  }

  /** What a « changements » of the StepRun `judgedId` of a `running` PhaseRun does, `afterChanges` having said it. */
  private async onChanges(tx: Tx, loaded: Loaded, judgedId: string, changes: Exclude<AfterChanges, { move: 'refused' }>): Promise<void> {
    if (changes.move === 'take') return this.takeLoopBack(tx, loaded, changes.loopBack, loaded.phaseRun.loopBacks);
    const judged = loaded.stepRuns.find((run) => run.id === judgedId);
    if (judged) await this.raiseExhausted(tx, loaded, judged, changes.move === 'exhausted' ? changes : null);
  }

  /**
   * Takes `loopBack` once more on top of `counted`: the PhaseRun `running`
   * with its Retours counted, then the work from the Retour's target undone
   * (`supersedeFrom`) and its start asked at the next iteration, reason
   * `loop-back`. The caller advances.
   */
  private async takeLoopBack(tx: Tx, loaded: Loaded, loopBack: LoopBack, counted: readonly PhaseRunLoopBack[]): Promise<void> {
    const row = await tx.phaseRun.update({
      where: { id: loaded.row.id },
      data: { loopBacks: json(countTaken(counted, loopBack)), state: 'running', waitingOn: null },
      select: PHASE_RUN_VIEW,
    });
    await this.publishPhaseRun(tx, row);
    await this.supersedeAndAsk(tx, await this.load(tx, loaded.row.id), loopBack.to, LOOP_BACK);
  }

  /**
   * The item stops on « Maximum de Retours atteint »: the PhaseRun `waiting`
   * on `decision`, and the Décision `loop-back.exhausted` of the PhaseRun
   * raised, labelled by the item's module (`PHASE_ITEMS`). `exhausted`: the
   * Retour reached its maximum, « Encore un passage » offered; `null`: no
   * Retour leaves the Étape, only « Arrêter ». Its Session to read is the
   * judging StepRun's, else that of the Retour target's last StepRun; its
   * `itemType` lets the page say what stopped (« le Ticket s’est arrêté »).
   */
  private async raiseExhausted(tx: Tx, loaded: Loaded, judged: StepRun, exhausted: { loopBack: LoopBack; taken: number } | null): Promise<void> {
    const phaseRun = await this.publishPhaseRun(
      tx,
      await tx.phaseRun.update({ where: { id: loaded.row.id }, data: { state: 'waiting', waitingOn: 'decision' }, select: PHASE_RUN_VIEW }),
    );
    const step = this.stepOf(loaded, judged.stepId);
    const target = exhausted ? this.stepOf(loaded, exhausted.loopBack.to) : null;
    const sessionId = judged.sessionId ?? (target ? loaded.stepRuns.filter((run) => run.stepId === target.id).at(-1)?.sessionId : null) ?? null;
    const phase = loaded.definition.phases.find((candidate) => candidate.id === loaded.row.phaseId);
    const project = loaded.row.projectId === null ? null : await tx.project.findUnique({ where: { id: loaded.row.projectId }, select: { displayName: true } });
    const label = await this.items.label(tx, phaseRun, phase?.name ?? loaded.row.phaseId);
    await this.decisions.raise(tx, {
      kind: 'loop-back.exhausted',
      projectId: loaded.row.projectId,
      projectName: project?.displayName ?? null,
      subjectType: 'phase-run',
      subjectId: loaded.row.id,
      label: label.slice(0, DECISION_LABEL_MAX),
      metaParts: [step.name.slice(0, DECISION_META_PART_MAX)],
      tone: 'caution',
      link: sessionId === null ? '/a-toi' : `/a-toi?session=${sessionId}`,
      params: {
        phaseRunId: loaded.row.id,
        itemType: loaded.row.itemType,
        stepRunId: judged.id,
        stepName: step.name,
        targetName: target?.name ?? null,
        taken: exhausted?.taken ?? null,
        max: exhausted?.loopBack.max ?? null,
        canContinue: exhausted !== null,
        sessionId,
      },
    });
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
   * by the guard is ready), `failed` when one is `failed`, none is open and
   * no start `retry` or `rerunFrom` asked is held.
   */
  async advance(tx: Tx, phaseRun: Pick<PhaseRun, 'id'>): Promise<PhaseRun> {
    return (await this.advanceLoaded(tx, await this.lockAndLoad(tx, phaseRun.id))).phaseRun;
  }

  private async advanceLoaded(tx: Tx, loaded: Loaded): Promise<Loaded> {
    if (loaded.row.state !== 'running') return loaded;
    const phase = loaded.definition.phases.find((candidate) => candidate.id === loaded.row.phaseId);
    const guard = phase?.forEach ? this.guards.get(phase.forEach) : undefined;
    const pending = { ...loaded.pending };
    for (const ready of readySteps(loaded.definition, loaded.phaseRun, loaded.live, loaded.ancestors)) {
      const step = this.stepOf(loaded, ready.stepId);
      if (guard && !(await guard(tx, { projectId: loaded.row.projectId, phaseRun: loaded.phaseRun, stepId: step.id, kind: step.kind }))) continue;
      const asked = pending[step.id];
      await this.startStep(tx, loaded, step, ready.inputs, asked?.iteration ?? nextIteration(loaded.stepRuns, step.id), asked?.reason ?? null);
      delete pending[step.id];
    }
    if (Object.keys(pending).length !== Object.keys(loaded.pending).length) await this.writePending(tx, loaded.row.id, pending);

    const after = await this.load(tx, loaded.row.id);
    const current = currentStepRuns(after.live);
    if (current.some((run) => OPEN.includes(run.state))) return after;
    // A start `retry` or `rerunFrom` asked, held by the guard, keeps the PhaseRun `running`, for `startQueued`, whatever else failed.
    if (Object.keys(after.pending).length > 0) return after;
    if (current.some((run) => run.state === 'failed')) {
      await this.setPhaseRunState(tx, after.row.id, 'failed');
      return this.load(tx, after.row.id);
    }
    if (readySteps(after.definition, after.phaseRun, after.live, after.ancestors).length > 0) return after;
    await this.setPhaseRunState(tx, after.row.id, 'done');
    await this.passTurn(tx, after);
    return this.load(tx, after.row.id);
  }

  /**
   * Carries the outputs of a `done` StepRun along its arrows to other
   * Phases: those of the producing PhaseRun's version (what was drawn when
   * the work ran), each target Phase looked up by id in the Projet's active
   * version (nothing without one, nor without a Projet). Into a Phase of
   * `forEach` `idea.noted`, an Artefact of its type is admitted at once;
   * `idea.retained` and `ticket.ready` start nothing (« Démarrer la
   * Conception » and the Boucle admit them, lineage then finds this
   * PhaseRun). Into a Phase without `forEach`, through one of its first
   * Entrées, each Artefact starts a PhaseRun of its own, in its turn. Any
   * other arrow only feeds by lineage.
   */
  private async carry(tx: Tx, loaded: Loaded, done: StepRun): Promise<void> {
    const projectId = loaded.row.projectId;
    const arrows = crossingArrows(loaded.definition, done.stepId);
    if (projectId === null || arrows.length === 0) return;
    const active = await this.activeVersion(tx, projectId);
    if (!active) return;
    for (const arrow of arrows) {
      const phaseId = loaded.definition.steps.find((step) => step.id === arrow.to.stepId)?.phaseId;
      const phase = active.definition.phases.find((candidate) => candidate.id === phaseId);
      if (!phase) continue;
      for (const artifact of done.outputs.filter((output) => output.portId === arrow.from.portId)) {
        const item = { type: artifact.type, id: artifact.id };
        if (phase.forEach === null) {
          if (isFirstEntry(active.definition, phase.id, arrow.to)) await this.startInTurn(tx, { projectId, version: active, phaseId: phase.id, item, parent: loaded.row.id });
        } else if (phase.forEach === 'idea.noted' && FOR_EACH[phase.forEach].type === artifact.type) {
          await this.admit(tx, { projectId, phaseId: phase.id, item, parentPhaseRunId: loaded.row.id });
        }
      }
    }
  }

  /**
   * A PhaseRun of a Phase without `forEach` for `item`, pinned to the active
   * version: `running` and advanced when no other PhaseRun of that Phase in
   * the Projet holds the turn or waits for it, else `waiting` on `queue`.
   * Nothing when one of the same item is unfinished.
   */
  private async startInTurn(
    tx: Tx,
    { projectId, version, phaseId, item, parent }: { projectId: string; version: { id: string }; phaseId: string; item: PhaseItem; parent: string },
  ): Promise<void> {
    const unfinished = await tx.phaseRun.findFirst({ where: { projectId, phaseId, itemType: item.type, itemId: item.id, state: { in: UNFINISHED } }, select: { id: true } });
    if (unfinished) return;
    const turn = await tx.phaseRun.findFirst({ where: { projectId, phaseId, state: { in: [...HOLDING] } }, select: { id: true } });
    const row = await tx.phaseRun.create({
      data: {
        id: newId(),
        pilotId: currentPilotId(),
        projectId,
        processVersionId: version.id,
        parentPhaseRunId: parent,
        phaseId,
        itemType: item.type,
        itemId: item.id,
        state: turn ? 'waiting' : 'running',
        waitingOn: turn ? 'queue' : null,
        startedAt: new Date(),
      },
      select: PHASE_RUN_VIEW,
    });
    await this.publishPhaseRun(tx, row);
    if (!turn) await this.advanceLoaded(tx, await this.load(tx, row.id));
  }

  /**
   * Once a PhaseRun of a Phase without `forEach` is `done` or `stopped`: the
   * oldest PhaseRun of that Phase and Projet `waiting` on `queue` starts,
   * unless another still holds the turn (a `failed` one, until `retry` or
   * `stop`).
   */
  private async passTurn(tx: Tx, finished: Loaded): Promise<void> {
    const { projectId, phaseId } = finished.row;
    const phase = finished.definition.phases.find((candidate) => candidate.id === phaseId);
    if (projectId === null || !phase || phase.forEach !== null) return;
    const others = await tx.phaseRun.findMany({
      where: { projectId, phaseId, state: { in: [...HOLDING] } },
      select: { id: true, state: true, waitingOn: true },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    });
    if (others.some((other) => other.state !== 'waiting' || other.waitingOn !== 'queue')) return;
    const next = others[0];
    if (!next) return;
    await this.publishPhaseRun(tx, await tx.phaseRun.update({ where: { id: next.id }, data: { state: 'running', waitingOn: null, startedAt: new Date() }, select: PHASE_RUN_VIEW }));
    await this.advanceLoaded(tx, await this.load(tx, next.id));
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
    let stepRun = toStepRun(row, loaded.definition);
    if (handler) {
      const state = await handler.start(tx, this.contextOf(loaded, stepRun));
      if (state !== 'running') stepRun = toStepRun(await tx.stepRun.update({ where: { id: stepRun.id }, data: { state }, select: STEP_RUN_VIEW }), loaded.definition);
    }
    await this.publishStepRun(tx, stepRun);
    return stepRun;
  }

  private async writeResult(tx: Tx, definition: ProcessDefinition, stepRun: StepRun, result: StepResult): Promise<void> {
    switch (result.state) {
      case 'done':
        await this.writeStepRun(tx, definition, stepRun.id, { state: 'done', outputs: json(zOutputs.parse(result.outputs)), verdict: result.verdict ?? null, failure: null, endedAt: new Date() });
        return;
      case 'failed':
        await this.writeStepRun(tx, definition, stepRun.id, { state: 'failed', failure: result.failure, endedAt: new Date() });
        return;
      case 'interrupted':
      case 'blocked':
        await this.writeStepRun(tx, definition, stepRun.id, { state: result.state, failure: result.failure });
        return;
      default:
        await this.writeStepRun(tx, definition, stepRun.id, { state: result.state, failure: null });
    }
  }

  /** The StepRun of `stepId` a restart wrote after `since`, or `held` while the guard refuses it. */
  private restarted(after: Loaded, stepId: string, since: string): Restart {
    const started = after.stepRuns.filter((run) => run.stepId === stepId && run.id > since).at(-1);
    return started ?? 'held';
  }

  /** An unfinished PhaseRun of the same item and Phase but `row`: the item went through the Phase again. */
  private async anotherUnfinished(tx: Tx, row: PhaseRunRow): Promise<boolean> {
    const other = await tx.phaseRun.findFirst({
      where: { projectId: row.projectId, builtinTemplate: row.builtinTemplate, phaseId: row.phaseId, itemType: row.itemType, itemId: row.itemId, state: { in: UNFINISHED }, id: { not: row.id } },
      select: { id: true },
    });
    return other !== null;
  }

  /**
   * A `failed` PhaseRun `running` again, then each of its StepRuns published
   * anew: a page drops a finished PhaseRun's StepRuns, as `GET /api/state`
   * does, and gets them back so.
   */
  private async reopen(tx: Tx, loaded: Loaded): Promise<void> {
    await this.setPhaseRunState(tx, loaded.row.id, 'running');
    if (loaded.row.state === 'failed') for (const run of loaded.stepRuns) await this.publishStepRun(tx, run);
  }

  /** The pending starts: the engine's own, in no view, so no event. */
  private async writePending(tx: Tx, id: string, pending: PendingStarts): Promise<void> {
    await tx.phaseRun.update({ where: { id }, data: { pendingStarts: json(pending) }, select: { id: true } });
  }

  private async writeStepRun(tx: Tx, definition: ProcessDefinition, id: string, data: Prisma.StepRunUpdateInput): Promise<void> {
    await this.publishStepRun(tx, toStepRun(await tx.stepRun.update({ where: { id }, data, select: STEP_RUN_VIEW }), definition));
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
    const phaseRun = toPhaseRun(row);
    const [definition, stepRuns, lineage] = await Promise.all([
      this.definitionFor(tx, row),
      tx.stepRun.findMany({ where: { phaseRunId }, select: STEP_RUN_VIEW, orderBy: { id: 'asc' } }),
      ancestors(tx, phaseRun),
    ]);
    const pending = zPendingStarts.parse(row.pendingStarts);
    const runs = stepRuns.map((stepRun) => toStepRun(stepRun, definition));
    const live = runs.filter((run) => !(run.state === 'failed' && pending[run.stepId]?.retryOf !== undefined));
    return { row, phaseRun, definition, stepRuns: runs, pending, live, ancestors: lineage };
  }

  /** What a new PhaseRun of `projectId` is pinned to: its active version, or without a Projet the builtin « Process Crewdeck ». */
  private async pinFor(tx: Tx, projectId: string | null): Promise<{ pin: Pin; definition: ProcessDefinition }> {
    if (projectId === null) return { pin: { version: null, builtinTemplate: WITHOUT_PROJECT }, definition: BUILTIN_TEMPLATES[WITHOUT_PROJECT] };
    const version = await this.activeVersion(tx, projectId);
    if (!version) throw new EngineInputError(`The Projet ${projectId} has no active version of its Process.`);
    return { pin: { version, builtinTemplate: null }, definition: version.definition };
  }

  /** The definition a PhaseRun is pinned to: its version's, or the builtin one it runs on without a Projet. */
  definitionFor(tx: Tx, row: Pick<PhaseRunRow, 'processVersionId' | 'builtinTemplate'>): Promise<ProcessDefinition> {
    return row.processVersionId === null ? Promise.resolve(BUILTIN_TEMPLATES[zBuiltinTemplateId.parse(row.builtinTemplate)]) : this.definitionOf(tx, row.processVersionId);
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
    if (!step) throw new EngineInputError(`The Phase ${loaded.row.phaseId} of ${loaded.phaseRun.processVersion === null ? loaded.phaseRun.builtinTemplate : `version ${loaded.phaseRun.processVersion}`} has no Étape ${stepId}.`);
    return step;
  }

  private contextOf(loaded: Loaded, stepRun: StepRun): StepRunContext {
    return { phaseRun: loaded.phaseRun, stepRun, step: this.stepOf(loaded, stepRun.stepId), definition: loaded.definition };
  }
}
