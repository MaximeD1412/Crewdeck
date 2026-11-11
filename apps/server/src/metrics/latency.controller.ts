import { zLatencyBatch } from '@crewdeck/contracts';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiNoContentResponse } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { LatencyService } from './latency.service.js';

export class LatencyBatchDto extends createZodDto(zLatencyBatch) {}

/**
 * `POST /api/metrics/latency` (204): the delays the page measured, as JSON or
 * as the `text/plain` of `sendBeacon` (`readBeaconBody`).
 */
@Controller('metrics')
export class LatencyController {
  constructor(private readonly latency: LatencyService) {}

  @Post('latency')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'The samples are written, but those over 10 min (a clock off).' })
  async report(@Body() batch: LatencyBatchDto): Promise<void> {
    await this.latency.record(batch.samples);
  }
}
