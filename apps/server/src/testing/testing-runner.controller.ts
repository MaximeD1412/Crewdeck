import { zTestingRunnerCapabilities } from '@crewdeck/contracts';
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { conflict } from '../errors/app-error.js';
import { Public } from '../scope/public.decorator.js';
import { FAKES, type Fakes } from './fakes.js';

export class TestingRunnerCapabilitiesDto extends createZodDto(zTestingRunnerCapabilities) {}

const noRunner = () => conflict('testing.no-runner', 'Aucun Runner de test connecté : lance d’abord un scénario qui en relie un.');

/**
 * `POST /api/testing/runner/capabilities` (body `{ engines }`): the fake
 * Runner of the scenario sends them, as a Runner whose Compte IA was just
 * connected; the server stores them as it would a real Runner's (204). 409
 * `testing.no-runner` while no scenario's Runner is connected.
 * `POST /api/testing/runner/disconnect` stops it, as a Runner whose machine
 * went to sleep (204); `/reconnect` connects it again, as the Pilote who
 * relaunches it (204; 409 `testing.no-runner` when no scenario connected
 * one). Mounted
 * outside production only (`TestingModule`); public, as the scenarios: the
 * fake Runner is the server's own.
 */
@Public()
@Controller('testing/runner')
export class TestingRunnerController {
  constructor(@Inject(FAKES) private readonly fakes: Fakes) {}

  @Post('capabilities')
  @HttpCode(204)
  report(@Body() { engines }: TestingRunnerCapabilitiesDto): void {
    if (!this.fakes.runner.report(engines)) throw noRunner();
  }

  @Post('disconnect')
  @HttpCode(204)
  disconnect(): void {
    this.fakes.runner.disconnect();
  }

  @Post('reconnect')
  @HttpCode(204)
  async reconnect(): Promise<void> {
    if (!(await this.fakes.runner.reconnect())) throw noRunner();
  }
}
