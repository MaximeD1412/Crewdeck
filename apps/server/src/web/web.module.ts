import { type DynamicModule, Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import type { Env } from '../config/env.js';

/**
 * The web build of the same commit, at `/` (ADR 0009, « Delivery »): its
 * files, and `index.html` for every other path, where the page's router takes
 * over. `/api`, `/runner` and `/fake-github` stay the server's: an unknown path there answers
 * 404 JSON, never the page. Without `WEB_DIST_DIR` (development), Vite serves
 * the page and this module does nothing.
 */
@Module({})
export class WebModule {
  static forRoot(env: Env): DynamicModule {
    if (env.WEB_DIST_DIR === undefined) return { module: WebModule };
    return {
      module: WebModule,
      imports: [
        ServeStaticModule.forRoot({
          rootPath: env.WEB_DIST_DIR,
          exclude: ['/api/{*path}', '/runner/{*path}', '/runner-dist/{*path}', '/fake-github/{*path}'],
        }),
      ],
    };
  }
}
