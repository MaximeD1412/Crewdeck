import { type DynamicModule, Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { type Env, usesFakes } from '../../config/env.js';
import { GOOGLE_CLIENT, OidcGoogleClient } from './google.client.js';

/**
 * `GOOGLE_CLIENT` for every module: `OidcGoogleClient` on the environment's
 * OAuth client (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`); without it,
 * nothing, and the sign-in with Google answers `google-unavailable`. With
 * `CREWDECK_FAKES=1` this module is empty and `TestingModule` binds
 * `GOOGLE_CLIENT` to its `FakeGoogle`: nothing here imports `src/testing/`.
 */
@Module({})
export class GoogleModule {
  static forRoot(env: Env): DynamicModule {
    const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = env;
    if (usesFakes(env) || !clientId || !clientSecret) return { module: GoogleModule };
    return {
      module: GoogleModule,
      global: true,
      providers: [
        {
          provide: GOOGLE_CLIENT,
          inject: [PinoLogger],
          useFactory: (logger: PinoLogger) => {
            logger.setContext('GoogleClient');
            return new OidcGoogleClient({ clientId, clientSecret }, logger);
          },
        },
      ],
      exports: [GOOGLE_CLIENT],
    };
  }
}
