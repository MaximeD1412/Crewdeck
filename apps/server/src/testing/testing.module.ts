import { type DynamicModule, Module } from '@nestjs/common';
import type { Env } from '../config/env.js';
import { createFakes, FAKES } from './fakes.js';
import { ScenariosService } from './scenarios.service.js';
import { TestingController } from './testing.controller.js';

/** The environments where the end-to-end tests seed the server; never production. */
const SEEDED_ENVIRONMENTS: ReadonlySet<Env['NODE_ENV']> = new Set(['development', 'test']);

/**
 * The scenarios of the end-to-end tests and of the captures (`/api/testing/*`).
 * In production the module is empty: no route, no provider, `/api/testing/*`
 * gives 404.
 */
@Module({})
export class TestingModule {
  static forEnvironment(env: Env): DynamicModule {
    if (!SEEDED_ENVIRONMENTS.has(env.NODE_ENV)) return { module: TestingModule };
    return {
      module: TestingModule,
      controllers: [TestingController],
      providers: [ScenariosService, { provide: FAKES, useFactory: createFakes }],
      exports: [FAKES],
    };
  }
}
