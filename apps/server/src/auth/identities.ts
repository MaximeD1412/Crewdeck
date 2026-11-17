import type { IdentityProvider } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { newId } from '../ids.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** What a sign-up writes with: a transaction of the raw client (no scope exists before the Pilote). */
export type IdentitiesTx = Pick<Prisma.TransactionClient, 'pilot' | 'pilotIdentity'>;

/** What a sign-in by address writes with: a sign-up's, and the address's advisory lock. */
export type AddressTx = IdentitiesTx & Pick<Prisma.TransactionClient, '$executeRaw'>;

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

/** Whether `error` is Prisma's unique violation (P2002): two first sign-ins of one Identité at once, the loser rolled back. */
export const isUniqueViolation = (error: unknown): boolean => (error as { code?: unknown } | null)?.code === 'P2002';

/** An Identité that carries a verified address: by a link (`subject` is the address) or Google (`subject` is its `sub`). */
export interface AddressIdentity {
  readonly provider: 'email' | 'google';
  readonly subject: string;
  /** Verified, lower-cased. */
  readonly email: string;
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

  /**
   * The Pilote of `identity` (ADR 0014): theirs when it is known (a Google
   * account's address refreshed), else the Pilote whose Identité of the
   * other kind (`email` for a Google account, `google` for a link) has the
   * same verified address and who has none of this kind (at most one of
   * each), the oldest, the Identité added to them; else a new Pilote. Two
   * Google accounts are never one Pilote by their address, nor is a GitHub
   * account joined. The first sign-ins of one address wait on its advisory
   * lock, by a link as with Google: two at once make one Pilote.
   */
  async signInByAddress(tx: AddressTx, identity: AddressIdentity, timeZone: string): Promise<string> {
    const { provider, subject, email } = identity;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`identity-address:${email}`}))`;
    const known = await this.pilotOf(provider, subject, tx);
    if (known) {
      if (provider === 'google') await tx.pilotIdentity.updateMany({ where: { provider, subject }, data: { email } });
      return known;
    }
    const sameAddress = await tx.pilotIdentity.findFirst({
      where: { provider: provider === 'google' ? 'email' : 'google', email, pilot: { identities: { none: { provider } } } },
      orderBy: { createdAt: 'asc' },
      select: { pilotId: true },
    });
    if (!sameAddress) return this.signUp(tx, { provider, subject, email, login: null, displayName: displayNameOf(email), timeZone });
    await tx.pilotIdentity.create({ data: { id: newId(), pilotId: sameAddress.pilotId, provider, subject, email, login: null } });
    return sameAddress.pilotId;
  }

  /** Creates the Pilote and their first Identité with `tx`; their id. */
  async signUp(tx: IdentitiesTx, { provider, subject, email, login, displayName, timeZone, avatarUrl = null }: SignUp): Promise<string> {
    const pilotId = newId();
    await tx.pilot.create({ data: { id: pilotId, displayName, avatarUrl, timeZone } });
    await tx.pilotIdentity.create({ data: { id: newId(), pilotId, provider, subject, email, login } });
    return pilotId;
  }
}
