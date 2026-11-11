import { type RunnerMessageOf, type RunnerToServer, type RunnerToServerType, zRunnerToServer } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { runInPilotScope } from '../scope/scope.context.js';
import type { OutgoingRunnerMessage } from './runner-connections.js';

/** Who sent a message, and how to answer it. */
export interface RunnerContext {
  readonly pilotId: string;
  readonly runnerId: string;
  reply(message: OutgoingRunnerMessage): void;
}

export type RunnerHandler<T extends RunnerToServerType> = (message: RunnerMessageOf<T>, context: RunnerContext) => void | Promise<void>;

/** A Runner's message as the server reads it: one of `RunnerToServer`, else `undefined` (not JSON, or not one of the protocol's). */
export const parseRunnerMessage = (text: string): RunnerToServer | undefined => {
  try {
    const parsed = zRunnerToServer.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The handlers of the Runner's messages, one per `type`: each module adds its
 * own (`registerRunnerHandler`, in its `onModuleInit`): the heartbeat
 * (`RunnersGateway`), later the capabilities (RUNNER-7), the Sessions
 * (RUNNER-9), the relay (SESSION-1). A handler runs in the scope of the
 * Runner's Pilote (ADR 0008). `hello` is the gateway's own, before any.
 */
@Injectable()
export class RunnerDispatcher {
  private readonly handlers = new Map<RunnerToServerType, RunnerHandler<RunnerToServerType>>();

  registerRunnerHandler<T extends RunnerToServerType>(type: T, handler: RunnerHandler<T>): void {
    if (this.handlers.has(type)) throw new Error(`A handler of the Runner's ${type} is already registered.`);
    this.handlers.set(type, handler as unknown as RunnerHandler<RunnerToServerType>);
  }

  /** Runs the handler of `message.type` in its Pilote's scope; `false` when it has none. */
  async dispatch(message: RunnerToServer, context: RunnerContext): Promise<boolean> {
    const handler = this.handlers.get(message.type);
    if (!handler) return false;
    await runInPilotScope(context.pilotId, () => handler(message, context));
    return true;
  }
}
