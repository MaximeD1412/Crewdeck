import type { ScenarioRun } from '@crewdeck/contracts';
import { Controller, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { findScenario } from './scenarios/index.js';
import { ScenariosService } from './scenarios.service.js';

/**
 * `POST /api/testing/scenarios/:name` (body `{}`): resets the database and
 * the fakes, seeds the scenario, returns where the browser goes and with
 * which session cookie. Mounted outside production only (`TestingModule`).
 */
@Controller('testing')
export class TestingController {
  constructor(private readonly scenarios: ScenariosService) {}

  @Post('scenarios/:name')
  @HttpCode(200)
  async run(@Param('name') name: string): Promise<ScenarioRun> {
    const scenario = findScenario(name);
    if (!scenario) {
      throw new NotFoundException({ status: 404, code: 'testing.unknown-scenario', message: `Scénario de test inconnu : « ${name} ».` });
    }
    return this.scenarios.run(scenario);
  }
}
