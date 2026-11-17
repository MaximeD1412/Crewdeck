import { type GettingStartedStep, type Me, type MeIdentity, nextGettingStartedStep, zGettingStartedAdvance, zMe } from '@crewdeck/contracts';
import { Body, Controller, Get, HttpCode, Inject, Injectable, Module, type OnModuleInit, Post } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { AppError, conflict, unprocessable } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import type { GettingStartedStep as GettingStartedStepRow } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { usableModels } from '../runners/ai-accounts/ai-accounts.js';
import { EventsWriter } from '../realtime/events.writer.js';
import { assertFresh } from '../realtime/freshness.js';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../realtime/state-contributors.js';
import { Transactions, type Tx } from '../realtime/transactions.js';
import { currentPilotId } from '../scope/scope.context.js';

export class MeDto extends createZodDto(zMe) {}
export class GettingStartedAdvanceDto extends createZodDto(zGettingStartedAdvance) {}

/** What of the Pilote's row the page sees: `GET /api/me`, the `pilot` slice of `GET /api/state`, the payload of `pilot.upserted`. */
export const ME = { id: true, displayName: true, avatarUrl: true, timeZone: true, gettingStartedStep: true } as const;

type MeRow = Omit<Me, 'gettingStartedStep' | 'identities' | 'githubLinked'> & { gettingStartedStep: GettingStartedStepRow };

/** What of an Identité the page sees: its provider and what names it, the address or GitHub's login. */
const IDENTITY = { provider: true, subject: true, email: true, login: true } as const;

type IdentityRow = { provider: MeIdentity['provider']; subject: string; email: string | null; login: string | null };

/** How the Pilote signs in, and whether GitHub's tokens are there (they go when GitHub refuses their refresh). */
export interface Links {
  readonly identities: readonly IdentityRow[];
  readonly githubTokens: boolean;
}

const labelOf = (identity: IdentityRow): string => identity.email ?? identity.login ?? identity.subject;

/** The step as the contracts spell it (`ai-accounts`), Prisma's enum keeping `ai_accounts`. */
const stepOf = (row: GettingStartedStepRow): GettingStartedStep => (row === 'ai_accounts' ? 'ai-accounts' : row);
const rowOf = (step: GettingStartedStep): GettingStartedStepRow => (step === 'ai-accounts' ? 'ai_accounts' : step);

/** The Pilote's row, Identités and GitHub tokens, as the page reads them. */
export const toMe = (row: MeRow, { identities, githubTokens }: Links): Me => ({
  ...row,
  gettingStartedStep: stepOf(row.gettingStartedStep),
  identities: identities.map((identity) => ({
    provider: identity.provider,
    label: labelOf(identity),
    reconnect: identity.provider === 'github' && !githubTokens,
  })),
  githubLinked: githubTokens && identities.some((identity) => identity.provider === 'github'),
});

/** What reads the Pilote's links: their Identités and their GitHub tokens, both scoped. */
export type LinksReader = Pick<Tx, 'pilotIdentity' | 'githubUserToken'>;

/**
 * The Identités of the scope's Pilote, oldest first, and whether their
 * GitHub tokens are there. Queried on their own: `Pilot` is global, and a
 * global model never selects a scoped relation.
 */
export const linksOf = async (db: LinksReader): Promise<Links> => ({
  identities: await db.pilotIdentity.findMany({ select: IDENTITY, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
  githubTokens: (await db.githubUserToken.count()) > 0,
});

/** The Pilote `pilotId`, the scope's, as the page reads them; 401 once their row is gone. */
export const readMe = async (db: Pick<Tx, 'pilot'> & LinksReader, pilotId: string): Promise<Me> => {
  const pilot = await db.pilot.findUnique({ where: { id: pilotId }, select: ME });
  if (!pilot) throw new AppError(401, 'auth.required', MESSAGES['auth.required']);
  return toMe(pilot, await linksOf(db));
};

/**
 * Writes the Pilote as `tx` leaves them in `pilot.upserted` (their row's
 * `lastSeq` with it): a change of their Identités or of their GitHub tokens
 * shows in every tab.
 */
export const publishMe = async (tx: Tx, events: EventsWriter, pilotId: string): Promise<Me> => {
  const pilot = await readMe(tx, pilotId);
  const written = await events.write(tx, pilotId, 'pilot.upserted', pilot);
  await tx.pilot.update({ where: { id: pilotId }, data: { lastSeq: written } });
  return pilot;
};

/**
 * `GET /api/me`: who is signed in, which the page asks first; and the
 * getting started (« Premiers pas »), one step after the other.
 */
@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
  ) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The signed-in Pilote.', type: MeDto })
  me(): Promise<Me> {
    return readMe(this.prisma.scoped, currentPilotId());
  }

  /**
   * `POST /api/me/getting-started/advance`: from the step the page shows to
   * the next. 409 when the Pilote is no longer at `from` (another tab moved
   * on), 422 from `runner` without a linked Runner, and from `ai-accounts`
   * without a usable model (`usableModels`).
   */
  @Post('getting-started/advance')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The Pilote at the next step.', type: MeDto })
  advance(@Body() { from, seq }: GettingStartedAdvanceDto): Promise<Me> {
    const pilotId = currentPilotId();
    return this.transactions.run(async (tx) => {
      const row = await tx.pilot.findUnique({ where: { id: pilotId }, select: { gettingStartedStep: true, lastSeq: true } });
      if (!row) throw new AppError(401, 'auth.required', MESSAGES['auth.required']);
      assertFresh(row.lastSeq, BigInt(seq));
      if (stepOf(row.gettingStartedStep) !== from) throw conflict('realtime.stale', MESSAGES['realtime.stale']);
      if (from === 'runner' && (await tx.runner.count({ where: { revokedAt: null } })) === 0) {
        throw unprocessable('getting-started.runner-not-linked', MESSAGES['getting-started.runner-not-linked']);
      }
      if (from === 'ai-accounts' && (await usableModels(tx)).length === 0) {
        throw unprocessable('getting-started.no-usable-engine', MESSAGES['getting-started.no-usable-engine']);
      }
      const updated = await tx.pilot.update({ where: { id: pilotId }, data: { gettingStartedStep: rowOf(nextGettingStartedStep(from)) }, select: ME });
      const pilot = toMe(updated, await linksOf(tx));
      const written = await this.events.write(tx, pilotId, 'pilot.upserted', pilot);
      await tx.pilot.update({ where: { id: pilotId }, data: { lastSeq: written } });
      return pilot;
    });
  }
}

/** The `pilot` slice of `GET /api/state`. */
@Injectable()
export class PilotState implements StateContributor<'pilot'>, OnModuleInit {
  readonly key = 'pilot';

  constructor(@Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  snapshot(tx: Tx, pilotId: string): Promise<Me> {
    return readMe(tx, pilotId);
  }
}

@Module({ controllers: [MeController], providers: [PilotState] })
export class PilotsModule {}
