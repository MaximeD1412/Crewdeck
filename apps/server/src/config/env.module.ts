import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { Env } from './env.js';

/** The token of the parsed `Env`: `@Inject(ENV) private readonly env: Env`. */
export const ENV = Symbol('ENV');

@Global()
@Module({})
export class EnvModule {
  static forRoot(env: Env): DynamicModule {
    return { module: EnvModule, providers: [{ provide: ENV, useValue: env }], exports: [ENV] };
  }
}
