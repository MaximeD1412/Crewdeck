import { type DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import type { Env } from './config/env.js';
import { EnvModule } from './config/env.module.js';
import { ErrorFilter } from './errors/error.filter.js';
import { HealthModule } from './health/health.module.js';
import { type LogDestination, loggerParams } from './logging/logger.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TestingModule } from './testing/testing.module.js';

export interface AppModuleOptions {
  logs?: LogDestination;
  /** Modules a test adds beside the app's own (its probe routes). */
  imports?: ModuleMetadata['imports'];
}

/**
 * The app, with the conventions of ADR 0008 applied to every route: each
 * input parsed by its DTO's schema (`createZodDto` of a contract), each output
 * by its `@ZodResponse` DTO, each error rendered as the envelope.
 */
@Module({})
export class AppModule {
  static forRoot(env: Env, { logs, imports = [] }: AppModuleOptions = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [LoggerModule.forRoot(loggerParams(env, logs)), EnvModule.forRoot(env), PrismaModule, HealthModule, TestingModule.forEnvironment(env), ...imports],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
    };
  }
}
