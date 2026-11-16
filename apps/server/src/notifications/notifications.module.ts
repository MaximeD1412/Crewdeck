import { Injectable, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DecisionsModule } from '../decisions/decisions.module.js';
import { DecisionsService } from '../decisions/decisions.service.js';
import { SettingsModule } from '../settings/settings.module.js';
import { PushDelivery } from './push-delivery.js';
import { PushRule } from './push-rule.js';
import { ENV } from '../config/env.module.js';
import type { Env } from '../config/env.js';
import { InertPushSender, PushSender, WebPushSender } from './push-sender.js';
import { PushSubscriptionsController, PushSubscriptionsState } from './push-subscriptions.controller.js';
import { PushSubscriptions } from './push-subscriptions.js';

/** Hands every Décision opened, once committed, to `PushRule`: a failure there is logged, never the raiser's. */
@Injectable()
export class PushOnDecision implements OnModuleInit, OnModuleDestroy {
  private removal: (() => void) | null = null;

  constructor(
    private readonly decisions: DecisionsService,
    private readonly rule: PushRule,
    @InjectPinoLogger(PushOnDecision.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.removal = this.decisions.onCreated((pilotId) => {
      try {
        this.rule.created(pilotId);
      } catch (error) {
        this.logger.error({ err: error }, 'push rule failed');
      }
    });
  }

  onModuleDestroy(): void {
    this.removal?.();
  }
}

/** The push notifications (ATOI-4, US-18, ADR 0007 « Visibility and push », « Web Push »). */
@Module({
  imports: [DecisionsModule, SettingsModule],
  controllers: [PushSubscriptionsController],
  providers: [
    PushSubscriptions,
    PushSubscriptionsState,
    PushRule,
    PushDelivery,
    WebPushSender,
    {
      provide: PushSender,
      inject: [ENV, WebPushSender],
      useFactory: (env: Env, web: WebPushSender): PushSender => (env.CREWDECK_ENV === 'test' ? new InertPushSender() : web),
    },
    PushOnDecision,
  ],
})
export class NotificationsModule {}
