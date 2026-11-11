import { SESSION_COOKIE } from '../../auth/cookies.js';
import { WebSessions } from '../../auth/web-sessions.js';
import type { GitHubUser } from '@crewdeck/contracts';
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

/**
 * The Pilote of a scenario, signed in as the callback would leave them (their
 * `WebSession`, without their GitHub tokens): the session cookie the browser
 * carries. The fake GitHub knows them too.
 */
export const signInPilot = async (ctx: ScenarioContext): Promise<ScenarioSeed> => {
  seedGitHubUser(ctx);
  const pilot = await ctx.prisma.unscoped.pilot.create({
    // No avatar: the Cadre of the captures shows the initials, not an image that never loads.
    data: { id: newId(), githubUserId: BigInt(OCTOCAT.id), login: OCTOCAT.login, avatarUrl: null, timeZone: 'Europe/Paris' },
  });
  const token = await runInPilotScope(pilot.id, () => new WebSessions(ctx.prisma, new WsRevocations()).open(ctx.prisma.scoped, pilot.id, undefined));
  return { sessionCookie: `${SESSION_COOKIE}=${token}` };
};
