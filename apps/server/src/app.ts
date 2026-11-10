import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { z } from 'zod';
import { AppModule, type AppModuleOptions } from './app.module.js';
import type { Env } from './config/env.js';

// The messages of a schema's issues reach the page through `fields`: French, as every error message.
z.config(z.locales.fr());

export type AppOptions = AppModuleOptions;

/** OpenAPI, generated from the DTOs' schemas: `/api/docs` and `/api/docs.json`, never in production. */
const serveDocs = (app: INestApplication): void => {
  const config = new DocumentBuilder().setTitle('Crewdeck').setDescription('The API of Crewdeck (ADR 0008).').build();
  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs.json', yamlDocumentUrl: 'api/docs.yaml' });
};

/** The server as `main.ts` runs it and the tests boot it: every route under `/api`. */
export const createApp = async (env: Env, options: AppOptions = {}): Promise<INestApplication> => {
  const app = await NestFactory.create(AppModule.forRoot(env, options), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  if (env.NODE_ENV !== 'production') serveDocs(app);
  return app;
};
