import { type DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { AuthModule } from './auth/auth.module.js';
import { type Env, usesFakes } from './config/env.js';
import { EnvModule } from './config/env.module.js';
import { DevicesModule } from './devices/devices.module.js';
import { PublicConfigModule } from './config/public-config.controller.js';
import { ErrorFilter } from './errors/error.filter.js';
import { GitHubModule } from './github/github.module.js';
import { ReconciliationModule } from './github/reconciliation/reconciliation.module.js';
import { WebhooksModule } from './github/webhooks/webhooks.module.js';
import { HealthModule } from './health/health.module.js';
import { type LogDestination, loggerParams } from './logging/logger.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { PilotsModule } from './pilots/me.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { RunnersModule } from './runners/runners.module.js';
import { ScopeModule } from './scope/scope.module.js';
import { SensitiveActionsModule } from './sensitive-actions/sensitive-actions.module.js';
import { WebModule } from './web/web.module.js';

export interface AppModuleOptions {
  logs?: LogDestination;
  /** Modules a test adds beside the app's own (its probe routes). */
  imports?: ModuleMetadata['imports'];
}

/**
 * The fakes and the scenarios, with `CREWDECK_FAKES=1` only: a dynamic
 * `import()`, so that without it nothing of `src/testing/` is loaded (a test
 * walks the static imports of `main.ts`).
 */
const fakes = (env: Env): Promise<DynamicModule>[] =>
  usesFakes(env) ? [import('./testing/testing.module.js').then(({ TestingModule }) => TestingModule.forRoot())] : [];

/**
 * The app, with the conventions of ADR 0008 applied to every route: each
 * input parsed by its DTO's schema (`createZodDto` of a contract), each output
 * by its `@ZodResponse` DTO, each error rendered as the envelope, each route
 * but the `@Public()` ones run in the scope of its principal's Pilote.
 */
@Module({})
export class AppModule {
  static forRoot(env: Env, { logs, imports = [] }: AppModuleOptions = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot(loggerParams(env, logs)),
        EnvModule.forRoot(env),
        PrismaModule,
        ScopeModule,
        SensitiveActionsModule,
        RealtimeModule,
        HealthModule,
        PublicConfigModule,
        GitHubModule.forRoot(env),
        WebhooksModule,
        ReconciliationModule,
        ...fakes(env),
        AuthModule,
        PilotsModule,
        DevicesModule,
        RunnersModule,
        MetricsModule,
        WebModule.forRoot(env),
        ...imports,
      ],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
    };
  }
}
