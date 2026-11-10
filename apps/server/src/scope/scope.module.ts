import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScopeGuard, ScopeInterceptor } from './scope.guard.js';

/** The scope of a Pilote on every route (ADR 0008): the guard, then the handler in the scope. */
@Module({
  providers: [
    { provide: APP_GUARD, useClass: ScopeGuard },
    { provide: APP_INTERCEPTOR, useClass: ScopeInterceptor },
  ],
})
export class ScopeModule {}
