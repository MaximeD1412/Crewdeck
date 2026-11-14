import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.request.js';
import { bearerOf, RunnerTokens } from '../auth/runner-tokens.js';
import { AppError } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';

/** The request of a Runner's route, once its token is checked. */
export type RunnerRequest = AuthRequest & { runnerId?: string };

/**
 * The guard of the Runner's HTTP routes (`@Public()` for `ScopeGuard`): the
 * `Authorization: Bearer` token of a Runner no newer link revoked, else 401
 * `runner.token-invalid`. It replaces any session's principal: a page's
 * cookie never reaches these routes, and the token reaches no other.
 */
@Injectable()
export class RunnerTokenGuard implements CanActivate {
  constructor(private readonly tokens: RunnerTokens) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RunnerRequest>();
    delete request.principal;
    const token = bearerOf(request);
    const credential = token ? await this.tokens.find(token) : undefined;
    if (!credential || credential.revoked) throw new AppError(401, 'runner.token-invalid', MESSAGES['runner.token-invalid']);
    request.principal = { kind: 'runner', pilotId: credential.pilotId };
    request.runnerId = credential.runnerId;
    return true;
  }
}
