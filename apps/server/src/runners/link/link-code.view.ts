import type { LinkCodeState, LinkFailureReason, Pairing, RunnerLink } from '@crewdeck/contracts';
import type { RunnerLinkFailure } from '../../generated/prisma/client.js';

/** What of a `runner_link_codes` row the page sees: the `runner-link` slice and the payload of `runner-link.upserted`. */
export const LINK_VIEW = {
  id: true,
  shortId: true,
  state: true,
  failureReason: true,
  expiresAt: true,
  runnerPairing: true,
} as const;

interface LinkRow {
  id: string;
  shortId: string;
  state: LinkCodeState;
  failureReason: RunnerLinkFailure | null;
  expiresAt: Date;
  runnerPairing: unknown;
}

/** A reason as the API spells it (`already-used`) from the database's enum (`already_used`). */
export const reasonOf = (failure: RunnerLinkFailure): LinkFailureReason => failure.replaceAll('_', '-') as LinkFailureReason;

/** The database's enum of a reason. */
export const failureOf = (reason: LinkFailureReason): RunnerLinkFailure => reason.replaceAll('-', '_') as RunnerLinkFailure;

export const toRunnerLink = (row: LinkRow): RunnerLink => ({
  id: row.id,
  shortId: row.shortId,
  state: row.state,
  failureReason: row.failureReason ? reasonOf(row.failureReason) : null,
  expiresAt: row.expiresAt.toISOString(),
  runnerPairing: (row.runnerPairing as Pairing | null) ?? null,
});
