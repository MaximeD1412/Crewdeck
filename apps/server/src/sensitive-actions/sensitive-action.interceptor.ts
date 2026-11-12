import type { SensitiveActionId } from '@crewdeck/contracts';
import { type CallHandler, type ExecutionContext, Inject, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Observable, tap } from 'rxjs';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import type { PrincipalRequest } from '../scope/principal.js';
import { SENSITIVE_ACTION } from './sensitive-action.decorator.js';
import { type FreshnessCheck, SensitiveActionsService } from './sensitive-actions.service.js';

type SensitiveRequest = PrincipalRequest & { params?: Record<string, string | undefined> };

/**
 * Around each `@SensitiveAction` route: the handler runs with a record of its
 * freshness check. Once it answered, outside production, a handler that did
 * not call `assertFresh` fails with 500, so its test fails; the action is
 * logged at info with its Pilote and its resource (the route's `:id`), never
 * its body.
 */
@Injectable()
export class SensitiveActionInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly sensitive: SensitiveActionsService,
    @Inject(ENV) private readonly env: Env,
    @InjectPinoLogger(SensitiveActionInterceptor.name) private readonly logger: PinoLogger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.get<SensitiveActionId | undefined>(SENSITIVE_ACTION, context.getHandler());
    if (action === undefined) return next.handle();
    const check: FreshnessCheck = { checked: false };
    const request = context.switchToHttp().getRequest<SensitiveRequest>();
    return new Observable<unknown>((subscriber) =>
      this.sensitive.track(check, () => next.handle().subscribe(subscriber)),
    ).pipe(
      tap(() => {
        if (!check.checked && this.env.NODE_ENV !== 'production') {
          throw new Error(`Action sensible ${action} : le handler n'a pas appelé assertFresh`);
        }
        this.logger.info(
          { action, pilotId: request.principal?.pilotId ?? null, resourceId: request.params?.['id'] ?? null },
          'sensitive action run',
        );
      }),
    );
  }
}
