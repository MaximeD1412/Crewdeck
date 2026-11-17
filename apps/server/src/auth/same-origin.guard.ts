import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { appOrigin, type Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { AppError } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { type AuthRequest, headerOf } from './auth.request.js';

/**
 * A route only the page may call, signed in or not: its `Origin` must be the
 * app's, else 401 `auth.origin`, before its body is even read.
 * `SessionMiddleware` checks it only with the cookie; the routes that sign a
 * browser in have none yet.
 */
@Injectable()
export class SameOriginGuard implements CanActivate {
  private readonly origin: string;

  constructor(@Inject(ENV) env: Env) {
    this.origin = appOrigin(env);
  }

  canActivate(context: ExecutionContext): boolean {
    if (headerOf(context.switchToHttp().getRequest<AuthRequest>(), 'origin') !== this.origin) {
      throw new AppError(401, 'auth.origin', MESSAGES['auth.origin']);
    }
    return true;
  }
}
