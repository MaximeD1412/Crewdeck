import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
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

/**
 * Every route under `/api`, but the fake GitHub's (`/fake-github`, mounted
 * with `CREWDECK_FAKES=1` only), at the path the page reads GitHub at; and
 * `/api/ws` (ADR 0007) on the same HTTP server, with `ws` (without an
 * adapter, Nest would look for socket.io).
 */
export const mountApi = (app: INestApplication): void => {
  app.setGlobalPrefix('api', { exclude: ['fake-github/{*path}'] });
  app.useWebSocketAdapter(new WsAdapter(app));
};

/** The server as `main.ts` runs it and the tests boot it: every route under `/api`. */
export const createApp = async (env: Env, options: AppOptions = {}): Promise<INestApplication> => {
  const app = await NestFactory.create(AppModule.forRoot(env, options), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  mountApi(app);
  app.enableShutdownHooks();
  if (env.NODE_ENV !== 'production') serveDocs(app);
  return app;
};
