import { Module } from '@nestjs/common';
import { LatencyController } from './latency.controller.js';
import { LatencyRetention } from './latency.retention.js';
import { LatencyService } from './latency.service.js';

/**
 * The measured latency (CORE-8, ADR 0007): the page reports its samples to
 * `POST /api/metrics/latency`, `LatencyService.p95` gives the statistics the
 * p95 of 7 days, the samples are kept 30 days.
 */
@Module({
  controllers: [LatencyController],
  providers: [LatencyService, LatencyRetention],
  exports: [LatencyService],
})
export class MetricsModule {}
