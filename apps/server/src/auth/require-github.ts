import { conflict } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import type { ScopedPrisma } from '../prisma/prisma.service.js';

/**
 * 409 `github.not-linked` (ADR 0014): the request is right, the Pilote's
 * account is not in the state it needs, a `github` Identité with its tokens.
 * Never a sign-out: the page offers « Relier GitHub ».
 */
export const githubNotLinked = () => conflict('github.not-linked', MESSAGES['github.not-linked']);

/**
 * Throws 409 `github.not-linked` unless the Pilote `pilotId` has a `github`
 * Identité with its tokens: what a route that needs the Pilote's GitHub user
 * calls first, with its transaction or the scoped client.
 */
export const requireGithub = async (tx: Pick<ScopedPrisma, 'pilotIdentity' | 'githubUserToken'>, pilotId: string): Promise<void> => {
  const identities = await tx.pilotIdentity.count({ where: { pilotId, provider: 'github' } });
  const tokens = identities === 0 ? 0 : await tx.githubUserToken.count({ where: { pilotId } });
  if (tokens === 0) throw githubNotLinked();
};
