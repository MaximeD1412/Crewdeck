import type { INestApplication, NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

/** The server as `main.ts` runs it and the tests boot it: every route under `/api`. */
export const createApp = async (env: Env, options: NestApplicationOptions = {}): Promise<INestApplication> => {
  const app = await NestFactory.create(AppModule.forRoot(env), options);
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
};
