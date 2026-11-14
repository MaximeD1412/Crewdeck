import { type DynamicModule, Global, Module } from '@nestjs/common';
import { DecisionsModule } from '../decisions/decisions.module.js';
import { GITHUB_CLIENT } from '../github/github.client.js';
import { FakeGitHubController } from './fake-github.controller.js';
import { createFakes, FAKES, type Fakes } from './fakes.js';
import { ScenariosService } from './scenarios.service.js';
import { TestingController } from './testing.controller.js';
import { TestingDecisionsController } from './testing-decisions.controller.js';
import { TestingPilotController } from './testing-pilot.controller.js';
import { TestingRunnerController } from './testing-runner.controller.js';

/**
 * The fakes in place of GitHub and the Runner, and the scenarios of the
 * end-to-end tests and of the captures (`/api/testing/*`, and the change of
 * the Pilote that makes the page miss an event, the Décisions raised and
 * resolved as their modules would), what the page
 * reads from the fake GitHub (`/fake-github/*`). Imported only with
 * `CREWDECK_FAKES=1`, which the boot refuses in production, and only through
 * a dynamic `import()` (`AppModule`): without it, nothing of `src/testing/` is
 * loaded, and `/api/testing/*` and `/fake-github/*` give 404.
 *
 * Global: `GITHUB_CLIENT` is the fake GitHub wherever a module injects it.
 */
@Global()
@Module({})
export class TestingModule {
  static forRoot(): DynamicModule {
    return {
      module: TestingModule,
      imports: [DecisionsModule],
      controllers: [TestingController, TestingPilotController, TestingDecisionsController, TestingRunnerController, FakeGitHubController],
      providers: [
        ScenariosService,
        { provide: FAKES, useFactory: createFakes },
        { provide: GITHUB_CLIENT, inject: [FAKES], useFactory: (fakes: Fakes) => fakes.github },
      ],
      exports: [FAKES, GITHUB_CLIENT],
    };
  }
}
