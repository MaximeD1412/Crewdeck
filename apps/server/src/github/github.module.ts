import { type DynamicModule, Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { type Env, usesFakes } from '../config/env.js';
import { GITHUB_CLIENT } from './github.client.js';
import { OctokitGitHubClient } from './octokit.client.js';

/**
 * `GITHUB_CLIENT` for every module (ADR 0002): the real client on GitHub's
 * API. With `CREWDECK_FAKES=1` this module is empty and `TestingModule`
 * (`src/testing/`, imported by `AppModule` only then) binds `GITHUB_CLIENT` to
 * its `FakeGitHub`: nothing here imports `src/testing/`.
 */
@Module({})
export class GitHubModule {
  static forRoot(env: Env): DynamicModule {
    if (usesFakes(env)) return { module: GitHubModule };
    return {
      module: GitHubModule,
      global: true,
      providers: [
        {
          provide: GITHUB_CLIENT,
          inject: [PinoLogger],
          useFactory: (logger: PinoLogger) => {
            logger.setContext('GitHubClient');
            return new OctokitGitHubClient(env, logger);
          },
        },
      ],
      exports: [GITHUB_CLIENT],
    };
  }
}
