import { type DynamicModule, Module } from '@nestjs/common';
import { type Env, usesFakes } from '../config/env.js';
import { RunnersModule } from '../runners/runners.module.js';
import { FX_SOURCE, EcbFxSource, NoFxSource } from './fx-source.js';
import { FxRates } from './fx.job.js';
import { UsageController, UsageState } from './usage.controller.js';
import { UsageRetention } from './usage.retention.js';
import { UsageService } from './usage.service.js';

/**
 * The usage of the Comptes IA (US-55, RUNNER-13): the Runner's `usage`
 * messages stored, `GET /api/usage`, the `usage` slice, the ECB's rates and
 * the measures' retention. `FX_SOURCE` is the ECB's file, but with
 * `CREWDECK_FAKES=1` (`TestingModule` binds the fake) and in the tests
 * without the fakes (none: no call to the ECB from a test).
 */
@Module({})
export class UsageModule {
  static forRoot(env: Env): DynamicModule {
    const source = usesFakes(env) ? [] : [{ provide: FX_SOURCE, useClass: env.CREWDECK_ENV === 'test' ? NoFxSource : EcbFxSource }];
    return {
      module: UsageModule,
      imports: [RunnersModule],
      controllers: [UsageController],
      providers: [...source, UsageService, UsageState, FxRates, UsageRetention],
    };
  }
}
