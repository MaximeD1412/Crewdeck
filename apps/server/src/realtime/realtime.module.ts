import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EventsBus } from './events.bus.js';
import { EventsReplay } from './events.replay.js';
import { EventsWriter } from './events.writer.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeTiming } from './realtime.timing.js';
import { EventsRetention } from './retention.job.js';
import { Registry } from './registry.js';
import { STATE_CONTRIBUTORS } from './state-contributors.js';
import { StateController } from './state.controller.js';
import { TabPresence } from './tab-presence.js';
import { Transactions } from './transactions.js';
import { WS_AUTHENTICATORS } from './ws-authenticators.js';
import { WsRevocations } from './ws-revocations.js';

/**
 * Real time on the server (ADR 0007, CORE-5).
 *
 * - A change of the Process's state is written in `Transactions.run`, with its
 *   event (`EventsWriter.write`) in the same transaction; the events reach
 *   the bus after the commit, then the sockets of `/api/ws`.
 * - The convention every module follows: each table a command acts on has
 *   `lastSeq BigInt @map("last_seq")`, set to the `seq` its last event got;
 *   a command's body carries the `seq` the page acted on (`withSeq` of the
 *   contracts), and the service calls `assertFresh(row.lastSeq, body.seq)`
 *   before changing it: 409 `realtime.stale` when the row changed since.
 * - `GET /api/state` is composed of the slices of `STATE_SLICES` (contracts):
 *   a module adds its key there and its `StateContributor` to
 *   `STATE_CONTRIBUTORS`.
 * - The events are kept 7 days (`EventsRetention`).
 */
@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [StateController],
  providers: [
    EventsBus,
    Transactions,
    EventsWriter,
    EventsReplay,
    TabPresence,
    RealtimeTiming,
    RealtimeGateway,
    WsRevocations,
    EventsRetention,
    { provide: WS_AUTHENTICATORS, useFactory: () => new Registry() },
    { provide: STATE_CONTRIBUTORS, useFactory: () => new Registry() },
  ],
  exports: [Transactions, EventsWriter, EventsBus, TabPresence, WS_AUTHENTICATORS, WsRevocations, STATE_CONTRIBUTORS],
})
export class RealtimeModule {}
