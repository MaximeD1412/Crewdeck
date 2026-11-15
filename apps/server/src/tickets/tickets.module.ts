import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { TicketActivity } from './ticket-activity.js';
import { TicketsController } from './tickets.controller.js';
import { TicketsQueue } from './tickets.queue.js';
import { TicketsReconcile } from './tickets.reconcile.js';
import { CodeChangeState, MilestoneState, TicketState } from './tickets.state.js';
import { TicketsWebhooks } from './tickets.webhooks.js';
import { TicketsWriter } from './tickets.writer.js';

/**
 * The Tickets, milestones and changes of code of every Projet (BOUCLE-1),
 * whatever their Source: `TicketsWriter` for SOURCE-3, `TicketActivity` for
 * the Boucle, the GitHub side, the slices and the routes.
 */
@Module({
  imports: [ProjectsModule],
  controllers: [TicketsController],
  providers: [TicketsWriter, TicketActivity, TicketsQueue, TicketsWebhooks, TicketsReconcile, TicketState, MilestoneState, CodeChangeState],
  exports: [TicketsWriter, TicketActivity],
})
export class TicketsModule {}
