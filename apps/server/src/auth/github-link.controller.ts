import { Controller, Get, Inject, Query, Redirect, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { type Env, isDeployed } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { GITHUB_CLIENT, type GitHubClient } from '../github/github.client.js';
import { currentPilotId } from '../scope/scope.context.js';
import { SESSION_SECRET } from './auth.keys.js';
import type { AuthResponse } from './auth.request.js';
import { githubCallbackUrl } from './auth.controller.js';
import { OAUTH_COOKIE, OAUTH_COOKIE_PATH, serializeCookie } from './cookies.js';
import { newState, OAUTH_TTL_SECONDS, safeNext, sealOauthState } from './oauth-state.js';

/** Where « Relier GitHub » comes back by default: the Paramètres, where it is offered. */
export const LINK_DEFAULT_NEXT = '/parametres';

/**
 * « Relier GitHub » (CORE-11, ADR 0014): not public, the session's Pilote
 * links their GitHub account. GitHub comes back to the sign-in's callback
 * (the App has one), which tells a link by its sealed `intent`.
 */
@ApiExcludeController()
@Controller('auth/github')
export class GithubLinkController {
  private readonly secure: boolean;
  private readonly callbackUrl: string;

  constructor(
    @Inject(ENV) env: Env,
    @Inject(SESSION_SECRET) private readonly secret: Buffer,
    @Inject(GITHUB_CLIENT) private readonly github: GitHubClient,
  ) {
    this.secure = isDeployed(env);
    this.callbackUrl = githubCallbackUrl(env);
  }

  /** `GET /api/auth/github/link?next`: to GitHub's authorize page, the link's state (the session's Pilote) in a signed cookie. */
  @Get('link')
  @Redirect()
  link(@Res({ passthrough: true }) response: AuthResponse, @Query('next') next?: string): { url: string; statusCode: 302 } {
    const state = newState();
    const sealed = sealOauthState(this.secret, { intent: 'link', state, pilotId: currentPilotId(), next: safeNext(next, LINK_DEFAULT_NEXT) });
    response.appendHeader('Set-Cookie', serializeCookie(OAUTH_COOKIE, sealed, { maxAge: OAUTH_TTL_SECONDS, path: OAUTH_COOKIE_PATH, secure: this.secure }));
    return { url: this.github.authorizeUrl(state, this.callbackUrl), statusCode: 302 };
  }
}
