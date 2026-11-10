import { type DynamicModule, Module } from '@nestjs/common';
import type { Env } from './config/env.js';
import { EnvModule } from './config/env.module.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { WebModule } from './web/web.module.js';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return { module: AppModule, imports: [EnvModule.forRoot(env), PrismaModule, HealthModule, WebModule.forRoot(env)] };
  }
}
