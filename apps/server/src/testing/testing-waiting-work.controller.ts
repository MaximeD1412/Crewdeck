import { zTestingWaitingWork } from '@crewdeck/contracts';
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { RunnerOffline } from '../runners/runner-offline.service.js';
import { currentPilotId } from '../scope/scope.context.js';
import { FAKES, type Fakes } from './fakes.js';

export class TestingWaitingWorkDto extends createZodDto(zTestingWaitingWork) {}

/**
 * `POST /api/testing/runner/waiting-work` (body `{ projects }`): from now on
 * the fake waiting work declares these Projets for the Pilote signed in, then
 * « Runner hors ligne » is refreshed, as a module whose work starts waiting
 * would (ATOI-3; 204). Mounted outside production only (`TestingModule`),
 * behind the session like any route.
 */
@Controller('testing/runner/waiting-work')
export class TestingWaitingWorkController {
  constructor(
    @Inject(FAKES) private readonly fakes: Fakes,
    private readonly runnerOffline: RunnerOffline,
  ) {}

  @Post()
  @HttpCode(204)
  async declare(@Body() { projects }: TestingWaitingWorkDto): Promise<void> {
    const pilotId = currentPilotId();
    this.fakes.waitingWork.declare(pilotId, projects);
    await this.runnerOffline.refresh(pilotId);
  }
}
