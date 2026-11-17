import { SESSION_COOKIE } from '../../auth/cookies.js';
import { WebSessions } from '../../auth/web-sessions.js';
import type { GettingStartedStep, GitHubUser, IdentityProvider } from '@crewdeck/contracts';
import { newId } from '../../ids.js';
import { WsRevocations } from '../../realtime/ws-revocations.js';
import { runInPilotScope } from '../../scope/scope.context.js';
import type { ScenarioContext, ScenarioSeed } from './define.js';

/**
 * The GitHub user of the scenarios: the fake GitHub signs them in at once
 * (`/fake-github/login/oauth/authorize`). Their avatar is on a domain that
 * never resolves: no test reads GitHub.
 */
export const OCTOCAT: GitHubUser = { id: 583231, login: 'octocat', avatarUrl: 'https://avatars.example/u/583231' };

/** Seeds the fake GitHub user who signs in from `/connexion`, nobody signed in yet. */
export const seedGitHubUser = ({ fakes }: ScenarioContext): ScenarioSeed => {
  fakes.github.seedUser(OCTOCAT);
  return {};
};

/** The address of a scenario's Pilote signed in by email. */
export const PILOTE_ADDRESS = 'pilote@example.com';

/**
 * The Pilote of a scenario, signed in as the callback would leave them: their
 * Identités (`github` by default, its tokens stored as the fake GitHub gave
 * them: GitHub linked; `email` with `pilote@example.com`) and their
 * `WebSession`: the session cookie the browser carries, and their id. The fake
 * GitHub knows them too. Past the getting started (« Premiers pas ») unless
 * the scenario shows it.
 */
export const signInPilot = async (
  ctx: ScenarioContext,
  { gettingStartedStep = 'done', identities = ['github'] }: { gettingStartedStep?: GettingStartedStep; identities?: readonly IdentityProvider[] } = {},
): Promise<ScenarioSeed & { pilotId: string }> => {
  seedGitHubUser(ctx);
  const github = identities.includes('github');
  const pilot = await ctx.prisma.unscoped.pilot.create({
    // No avatar: the Cadre of the captures shows the initials, not an image that never loads.
    data: {
      id: newId(),
      displayName: github ? OCTOCAT.login : PILOTE_ADDRESS.split('@')[0] ?? PILOTE_ADDRESS,
      avatarUrl: null,
      timeZone: 'Europe/Paris',
      gettingStartedStep: gettingStartedStep === 'ai-accounts' ? 'ai_accounts' : gettingStartedStep,
    },
  });
  for (const provider of identities) {
    const identity =
      provider === 'github'
        ? { subject: String(OCTOCAT.id), email: null, login: OCTOCAT.login }
        : { subject: PILOTE_ADDRESS, email: PILOTE_ADDRESS, login: null };
    await ctx.prisma.unscoped.pilotIdentity.create({ data: { id: newId(), pilotId: pilot.id, provider, ...identity } });
  }
  if (github) await ctx.storeGithubTokens(pilot.id, ctx.fakes.github.tokensOf(OCTOCAT));
  const token = await runInPilotScope(pilot.id, () => new WebSessions(ctx.prisma, new WsRevocations()).open(ctx.prisma.scoped, pilot.id, undefined));
  return { sessionCookie: `${SESSION_COOKIE}=${token}`, pilotId: pilot.id };
};
