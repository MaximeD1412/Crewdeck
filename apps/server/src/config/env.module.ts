import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { Env } from './env.js';
import { VAPID, vapidKeys } from './vapid.js';

/** The token of the parsed `Env`: `@Inject(ENV) private readonly env: Env`. */
export const ENV = Symbol('ENV');

/** The parsed `Env`, and what is drawn from it once per boot (the VAPID keys), for every module. */
@Global()
@Module({})
export class EnvModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: EnvModule,
      providers: [
        { provide: ENV, useValue: env },
        { provide: VAPID, useValue: vapidKeys(env) },
      ],
      exports: [ENV, VAPID],
    };
  }
}
