import { z } from 'zod';
import { zErrorCode } from '../api/errors.js';
import { zCapabilities } from './capabilities.js';
import { runnerMessage } from './envelope.js';
import { zHeartbeat, zHeartbeatAck } from './heartbeat.js';
import { zHello, zHelloAccepted, zHelloRejected } from './hello.js';
import { zStepVerdict } from './step.js';

export { runnerMessage, type RunnerEnvelope, zRunnerEnvelope } from './envelope.js';

/**
 * The Runner protocol (ADR 0004, ADR 0007): JSON messages over one WebSocket,
 * `/api/ws?client=runner`, authenticated by the Runner's token
 * (`Authorization: Bearer …`). The server accepts `PROTOCOL_VERSION` and the
 * one before; an older Runner is told to update. Each later ticket adds its
 * messages to the two unions below, and its fixtures to
 * `fixtures/runner/<type>.json`.
 */
export const PROTOCOL_VERSION = 1;

/** The Runner sends `heartbeat` every 15 s; the server marks it « hors ligne » after 45 s without one (ADR 0004). */
export const HEARTBEAT_SECONDS = 15;
export const OFFLINE_AFTER_SECONDS = 45;

/** The close codes of the Runner's socket: an unknown or revoked token, a newer connection of the same Runner, a protocol too old. */
export const RUNNER_WS_CLOSE = { unauthorized: 4401, replaced: 4409, updateRequired: 4426 } as const;

/**
 * Server → Runner: a message it could not take (`protocol.invalid`: not JSON,
 * an unknown `type`, or fields outside its schema). The socket stays open.
 */
export const zProtocolError = runnerMessage('error', { code: zErrorCode });
export type ProtocolError = z.infer<typeof zProtocolError>;

/** Every message the Runner sends. */
export const zRunnerToServer = z.discriminatedUnion('type', [zHello, zHeartbeat, zCapabilities, zStepVerdict]);
export type RunnerToServer = z.infer<typeof zRunnerToServer>;
export type RunnerToServerType = RunnerToServer['type'];

/** Every message the server sends to the Runner. */
export const zServerToRunner = z.discriminatedUnion('type', [zHelloAccepted, zHelloRejected, zHeartbeatAck, zProtocolError]);
export type ServerToRunner = z.infer<typeof zServerToRunner>;
export type ServerToRunnerType = ServerToRunner['type'];

/** A message of `type`, both ways. */
export type RunnerMessageOf<T extends RunnerToServerType | ServerToRunnerType> = Extract<RunnerToServer | ServerToRunner, { type: T }>;
