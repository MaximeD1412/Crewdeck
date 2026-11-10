import { type CallHandler, type CanActivate, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { AppError } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import type { Principal, PrincipalRequest } from './principal.js';
import { IS_PUBLIC } from './public.decorator.js';
import { runInPilotScope } from './scope.context.js';

const principalOf = (context: ExecutionContext): Principal | undefined =>
  context.switchToHttp().getRequest<PrincipalRequest>().principal;

const isPublic = (reflector: Reflector, context: ExecutionContext): boolean =>
  reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [context.getHandler(), context.getClass()]) === true;

/**
 * The global guard of ADR 0008: a route not marked `@Public()` needs the
 * principal the auth layer set on the request, else 401 `auth.required`.
 */
@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (isPublic(this.reflector, context) || principalOf(context)) return true;
    throw new AppError(401, 'auth.required', MESSAGES['auth.required']);
  }
}

/**
 * Runs the handler (its pipes included) inside the scope of the principal's
 * Pilote. A guard cannot wrap the handler's execution, an interceptor can:
 * what the handler awaits stays in the scope, each request in its own.
 */
@Injectable()
export class ScopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const principal = principalOf(context);
    if (!principal) return next.handle();
    return new Observable((subscriber) => runInPilotScope(principal.pilotId, () => next.handle().subscribe(subscriber)));
  }
}
