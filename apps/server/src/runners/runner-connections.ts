import { type ServerToRunner, zServerToRunner } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { newId } from '../ids.js';

type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'id' | 'at'> : never;

/** A message to the Runner without its envelope: `stamp` gives it its `id` and `at`. */
export type OutgoingRunnerMessage = WithoutEnvelope<ServerToRunner>;

/** `message` with a new `id` and the current `at`, validated against `ServerToRunner` (an invalid one is a bug of the server: it throws). */
export const stamp = (message: OutgoingRunnerMessage): ServerToRunner =>
  zServerToRunner.parse({ ...message, id: newId(), at: new Date().toISOString() });

/** The socket of a Runner whose `hello` was accepted. */
export interface RunnerLink {
  readonly pilotId: string;
  readonly runnerId: string;
  /** Sends a stamped message (`stamp`). */
  send(message: ServerToRunner): void;
  close(code: number, reason: string): void;
}

/**
 * The socket of each Pilote's Runner (one Runner per Pilote, one socket per
 * Runner), in the memory of this server process: a newer accepted `hello`
 * takes the place of the one before, which its caller closes with 4409.
 */
@Injectable()
export class RunnerConnections {
  private readonly links = new Map<string, RunnerLink>();

  /** The socket of `pilotId`'s Runner, `undefined` when it is not connected. */
  of(pilotId: string): RunnerLink | undefined {
    return this.links.get(pilotId);
  }

  /** `link` becomes its Pilote's socket; returns the one it replaces. */
  take(link: RunnerLink): RunnerLink | undefined {
    const previous = this.links.get(link.pilotId);
    this.links.set(link.pilotId, link);
    return previous === link ? undefined : previous;
  }

  /** Forgets `link` when it still is its Pilote's socket; returns whether it was. */
  release(link: RunnerLink): boolean {
    if (this.links.get(link.pilotId) !== link) return false;
    this.links.delete(link.pilotId);
    return true;
  }
}
