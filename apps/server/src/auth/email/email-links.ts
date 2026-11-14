import { createHash, randomBytes } from 'node:crypto';
import { EMAIL_LINK_TTL_SECONDS } from '@crewdeck/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { appOrigin, type Env } from '../../config/env.js';
import { ENV } from '../../config/env.module.js';
import { AppError } from '../../errors/app-error.js';
import { MESSAGES } from '../../errors/messages.js';
import { newId } from '../../ids.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { displayNameOf, isUniqueViolation, PilotIdentities } from '../identities.js';
import { MAILER, type Mailer } from '../mail/mailer.js';
import { signInLinkMail } from '../mail/sign-in-link.js';
import { safeNext, safeTimeZone } from '../oauth-state.js';
import { WebSessions } from '../web-sessions.js';
import { EmailLinkLimiter } from './email-link-limiter.js';

/** Where the link leads: the page that consumes it with a `POST`, the token in the fragment (never sent to a server). */
export const LINK_PATH = '/connexion/lien';

/** What `email_login_tokens` keeps of a link's token: its SHA-256, in hex. */
export const hashOf = (token: string): string => createHash('sha256').update(token).digest('hex');


const linkInvalid = (): AppError => new AppError(422, 'auth.link-invalid', MESSAGES['auth.link-invalid']);

/** A browser signed in by a link: the session's token for its cookie, and the page to land on. */
export interface LinkSignIn {
  readonly sessionToken: string;
  readonly next: string;
}

/**
 * The sign-in by a link sent by email (US-1, ADR 0014): a link of 15 minutes
 * that works once, its token's SHA-256 only in `email_login_tokens`. An
 * unknown address gets its Pilote when the link is used, not when it is
 * asked for: a typo creates no account.
 */
@Injectable()
export class EmailLinks {
  private readonly origin: string;

  constructor(
    @Inject(ENV) env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly prisma: PrismaService,
    private readonly identities: PilotIdentities,
    private readonly sessions: WebSessions,
    private readonly limiter: EmailLinkLimiter,
    private readonly logger: PinoLogger,
  ) {
    this.origin = appOrigin(env);
    logger.setContext('EmailLinks');
  }

  /**
   * Draws a link for `email`, asked from `ip`, stores its hash and mails it.
   * Throws 429 past either limit, 500 `auth.mail-unavailable` (and keeps no
   * row) when the transport refuses the mail.
   */
  async request(email: string, next: string, ip: string): Promise<void> {
    this.limiter.hitIp(ip);
    const now = new Date(this.limiter.now());
    const token = randomBytes(32).toString('base64url');
    const id = newId();
    await this.prisma.unscoped.$transaction(async (tx) => {
      // One request of an address at a time: the count and the insert see each other.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`email-link:${email}`}))`;
      await this.limiter.checkAddress(tx, email);
      await tx.emailLoginToken.create({
        data: { id, email, tokenHash: hashOf(token), next: safeNext(next), createdAt: now, expiresAt: new Date(now.getTime() + EMAIL_LINK_TTL_SECONDS * 1000) },
      });
    });
    try {
      await this.mailer.send({ to: email, ...signInLinkMail(`${this.origin}${LINK_PATH}#${token}`) });
    } catch (error) {
      await this.prisma.unscoped.emailLoginToken.deleteMany({ where: { id } });
      // The transport's message may quote the address: only its SMTP code is logged.
      this.logger.warn({ responseCode: (error as { responseCode?: unknown } | null)?.responseCode ?? null }, 'Sign-in link mail refused');
      throw new AppError(500, 'auth.mail-unavailable', MESSAGES['auth.mail-unavailable']);
    }
  }

  /**
   * Uses the link of `token` once: in one transaction, marks it used if it is
   * neither used nor expired, finds the Pilote of its address or signs one up,
   * opens a session. 422 `auth.link-invalid` for an unknown, expired or used
   * link alike.
   */
  async verify(token: string, timeZone: string, userAgent: string | undefined): Promise<LinkSignIn> {
    try {
      return await this.consume(token, timeZone, userAgent);
    } catch (error) {
      // Two links of one new address used at once: the second sign-up lost the
      // race on its Identité and rolled back, its link unused; once more finds the Pilote.
      if (!isUniqueViolation(error)) throw error;
      return this.consume(token, timeZone, userAgent);
    }
  }

  /** Deletes the links drawn more than `olderThanMs` ago; how many. */
  async sweep(olderThanMs: number, now = new Date()): Promise<number> {
    const { count } = await this.prisma.unscoped.emailLoginToken.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - olderThanMs) } } });
    return count;
  }

  private consume(token: string, timeZone: string, userAgent: string | undefined): Promise<LinkSignIn> {
    const tokenHash = hashOf(token);
    return this.prisma.unscoped.$transaction(async (tx) => {
      const now = new Date();
      const { count } = await tx.emailLoginToken.updateMany({ where: { tokenHash, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (count !== 1) throw linkInvalid();
      const link = await tx.emailLoginToken.findUniqueOrThrow({ where: { tokenHash }, select: { email: true, next: true } });
      const pilotId =
        (await this.identities.pilotOf('email', link.email, tx)) ??
        (await this.identities.signUp(tx, {
          provider: 'email',
          subject: link.email,
          email: link.email,
          login: null,
          displayName: displayNameOf(link.email),
          timeZone: safeTimeZone(timeZone),
        }));
      return { sessionToken: await this.sessions.open(tx, pilotId, userAgent, now), next: link.next };
    });
  }
}
