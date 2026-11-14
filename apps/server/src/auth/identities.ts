import type { IdentityProvider } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { newId } from '../ids.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** What a sign-up writes with: a transaction of the raw client (no scope exists before the Pilote). */
export type IdentitiesTx = Pick<Prisma.TransactionClient, 'pilot' | 'pilotIdentity'>;

/** The longest `displayName` drawn from an address: GitHub's longest login. */
const DISPLAY_NAME_MAX = 39;

/** A new Pilote and their first Identité. */
export interface SignUp {
  readonly provider: IdentityProvider;
  /** The lower-cased address, Google's `sub`, GitHub's user id in decimal. */
  readonly subject: string;
  /** The verified address (`email`, `google`), else `null`. */
  readonly email: string | null;
  /** GitHub's login (`github`), else `null`. */
  readonly login: string | null;
  readonly displayName: string;
  readonly timeZone: string;
  readonly avatarUrl?: string | null;
}

/** The `displayName` of a Pilote signed up by `email`: its local part, at most 39 characters. */
export const displayNameOf = (email: string): string => email.slice(0, email.lastIndexOf('@')).slice(0, DISPLAY_NAME_MAX);

/**
 * The Identités of the Pilotes (ADR 0014): how each signs in, an address, a
 * Google account or a GitHub account, at most one of each. Unscoped: the
 * sign-in looks the Pilote up before any scope exists.
 */
@Injectable()
export class PilotIdentities {
  constructor(private readonly prisma: PrismaService) {}

  /** The Pilote of the Identité `provider`/`subject`, or `null`. */
  async pilotOf(provider: IdentityProvider, subject: string, tx: Pick<Prisma.TransactionClient, 'pilotIdentity'> = this.prisma.unscoped): Promise<string | null> {
    const identity = await tx.pilotIdentity.findUnique({ where: { provider_subject: { provider, subject } }, select: { pilotId: true } });
    return identity?.pilotId ?? null;
  }

  /** Creates the Pilote and their first Identité with `tx`; their id. */
  async signUp(tx: IdentitiesTx, { provider, subject, email, login, displayName, timeZone, avatarUrl = null }: SignUp): Promise<string> {
    const pilotId = newId();
    await tx.pilot.create({ data: { id: pilotId, displayName, avatarUrl, timeZone } });
    await tx.pilotIdentity.create({ data: { id: newId(), pilotId, provider, subject, email, login } });
    return pilotId;
  }
}
