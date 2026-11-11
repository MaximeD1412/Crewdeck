import { Injectable } from '@nestjs/common';
import { AppError } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { RunnerPresence } from './runner-presence.service.js';
import { type OutgoingRunnerMessage, RunnerConnections, stamp } from './runner-connections.js';

/**
 * What the server asks of the Pilote's Runner (ADR 0004): the Boucle's
 * Sessions (RUNNER-9), the Contrat checks (RUNNER-11), the relay
 * (SESSION-1). Sent on the Runner's socket, never queued: a Runner offline
 * is a 422 `runner.offline`, the caller says it to the Pilote.
 */
@Injectable()
export class RunnerCommands {
  constructor(
    private readonly connections: RunnerConnections,
    private readonly presence: RunnerPresence,
  ) {}

  /** Validates `message` against `ServerToRunner` and sends it to `pilotId`'s Runner. */
  send(pilotId: string, message: OutgoingRunnerMessage): void {
    const stamped = stamp(message);
    const link = this.connections.of(pilotId);
    if (!link || !this.presence.isOnline(pilotId)) throw new AppError(422, 'runner.offline', MESSAGES['runner.offline']);
    link.send(stamped);
  }
}
