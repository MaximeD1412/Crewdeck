import { type AiAccount, type AiAccountModel, type Capabilities, isUsableAccount, zAiAccountList } from '@crewdeck/contracts';
import { Controller, Get, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { newId } from '../../ids.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EventsWriter } from '../../realtime/events.writer.js';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../../realtime/state-contributors.js';
import { afterCommit, Transactions, type Tx } from '../../realtime/transactions.js';
import { RunnerClock } from '../clock.js';
import { RunnerDispatcher } from '../runner-dispatcher.js';
import { AI_ACCOUNT_VIEW, rowOf, toAiAccount } from './ai-account.view.js';

export class AiAccountListDto extends createZodDto(zAiAccountList) {}

/** The Pilote's Comptes IA (scoped by `tx`), in the order of the Moteurs' ids. */
export const listAccounts = async (tx: Pick<Tx, 'aiAccount'>): Promise<AiAccount[]> =>
  (await tx.aiAccount.findMany({ select: AI_ACCOUNT_VIEW, orderBy: { engine: 'asc' } })).map(toAiAccount);

/**
 * The models a Rôle can run on (PARAM-2, PROJET-3, the getting started's
 * rule), each with its Moteur: the usable ones of the connected Comptes IA of
 * installed Moteurs, from the Runner's last report. `tx` is in the Pilote's
 * scope.
 */
export const usableModels = async (tx: Pick<Tx, 'aiAccount'>): Promise<(AiAccountModel & { engine: AiAccount['engine'] })[]> =>
  (await listAccounts(tx)).filter(isUsableAccount).flatMap((account) => account.models.filter((model) => model.usable).map((model) => ({ ...model, engine: account.engine })));

/** Called with the Pilote's id once a report of their Comptes IA is committed, in their scope. Must not throw. */
export type AiAccountsRecordedHook = (pilotId: string) => void;

/**
 * The Comptes IA (US-38, RUNNER-7): each `capabilities` message of the
 * Pilote's Runner upserts one row per Moteur it reports, with
 * `ai-account.upserted`, in one transaction. The credential never reaches the
 * server: the message carries a kind and a state, and a row has no column for
 * more. Who waits for a Moteur (the Inventaire, PROJET-4) learns of each
 * report once committed (`onRecorded`).
 */
@Injectable()
export class AiAccounts implements OnModuleInit {
  private readonly recordedHooks = new Set<AiAccountsRecordedHook>();

  constructor(
    private readonly dispatcher: RunnerDispatcher,
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly clock: RunnerClock,
  ) {}

  onModuleInit(): void {
    this.dispatcher.registerRunnerHandler('capabilities', (message, context) => this.record(context.pilotId, message.engines));
  }

  /** Calls `hook` after each report of a Pilote's Comptes IA is committed; returns its removal. */
  onRecorded(hook: AiAccountsRecordedHook): () => void {
    this.recordedHooks.add(hook);
    return () => this.recordedHooks.delete(hook);
  }

  /** Stores what each Moteur can run, as the Pilote's Runner reported it. */
  record(pilotId: string, engines: Capabilities['engines']): Promise<void> {
    const reportedAt = this.clock.now();
    return this.transactions.run(async (tx) => {
      for (const engine of engines) {
        const data = rowOf(engine, reportedAt);
        const row = await tx.aiAccount.upsert({
          where: { pilotId_engine: { pilotId, engine: data.engine } },
          create: { id: newId(), pilotId, ...data },
          update: data,
          select: AI_ACCOUNT_VIEW,
        });
        await this.events.write(tx, pilotId, 'ai-account.upserted', toAiAccount(row));
      }
      afterCommit(tx, () => {
        for (const hook of [...this.recordedHooks]) hook(pilotId);
      });
    });
  }
}

/** `GET /api/ai-accounts`: the Pilote's Comptes IA, at most one per Moteur. */
@Controller('ai-accounts')
export class AiAccountsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The Pilote’s Comptes IA.', type: AiAccountListDto })
  async list(): Promise<{ items: AiAccount[] }> {
    return { items: await listAccounts(this.prisma.scoped) };
  }
}

/** The `ai-account` slice of `GET /api/state`: the same list. */
@Injectable()
export class AiAccountState implements StateContributor<'ai-account'>, OnModuleInit {
  readonly key = 'ai-account';

  constructor(@Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  snapshot(tx: Tx): Promise<AiAccount[]> {
    return listAccounts(tx);
  }
}
