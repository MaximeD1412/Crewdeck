import { Global, Module } from '@nestjs/common';
import { GitHubDeliveries } from './deliveries.js';
import { GitHubEvents, WebhookDispatcher } from './dispatcher.js';
import { GitHubInstallations } from './installations.js';
import { WebhooksController } from './webhooks.controller.js';

/**
 * GitHub's webhooks (PROJET-1): `POST /api/github/webhooks`, the deliveries
 * deduplicated, the installations index, the dispatch per Pilote. A module
 * subscribes to the events it needs with `GitHubEvents.on` (global).
 */
@Global()
@Module({
  controllers: [WebhooksController],
  providers: [GitHubDeliveries, GitHubInstallations, GitHubEvents, WebhookDispatcher],
  exports: [GitHubEvents, GitHubInstallations],
})
export class WebhooksModule {}
