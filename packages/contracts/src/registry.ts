import type { z } from 'zod';
import { zErrorEnvelope } from './api/errors.js';
import { zHealth } from './api/health.js';
import { LINK_ATTEMPTS_PER_MINUTE, LINK_CODE_TTL_SECONDS, LINK_POLL_SECONDS, zRunnerLinkAccepted, zRunnerLinkPairing, zRunnerLinkRequest, zRunnerLinkStatus } from './api/runner-link.js';
import { zHeartbeat, zHeartbeatAck } from './runner/heartbeat.js';
import { zHello, zHelloAccepted, zHelloRejected } from './runner/hello.js';
import { HEARTBEAT_SECONDS, OFFLINE_AFTER_SECONDS, PROTOCOL_VERSION, RUNNER_WS_CLOSE, zProtocolError, zRunnerEnvelope } from './runner/protocol.js';

/**
 * The schemas `nx run contracts:generate` writes as JSON Schema and Go types
 * (`apps/runner/internal/contracts/<name>.go`). Add an entry for every schema
 * the Runner reads or writes: each message of the Runner protocol is one,
 * named `runner-<type>` (its Go type `Runner<Type>`).
 */
export const registry: readonly { name: string; schema: z.ZodType }[] = [
  { name: 'health', schema: zHealth },
  { name: 'error-envelope', schema: zErrorEnvelope },
  { name: 'runner-link-request', schema: zRunnerLinkRequest },
  { name: 'runner-link-accepted', schema: zRunnerLinkAccepted },
  { name: 'runner-link-pairing', schema: zRunnerLinkPairing },
  { name: 'runner-link-status', schema: zRunnerLinkStatus },
  { name: 'runner-envelope', schema: zRunnerEnvelope },
  { name: 'runner-hello', schema: zHello },
  { name: 'runner-hello-accepted', schema: zHelloAccepted },
  { name: 'runner-hello-rejected', schema: zHelloRejected },
  { name: 'runner-heartbeat', schema: zHeartbeat },
  { name: 'runner-heartbeat-ack', schema: zHeartbeatAck },
  { name: 'runner-error', schema: zProtocolError },
];

/**
 * The constants the Runner reads as the server does, written as Go constants
 * to `apps/runner/internal/contracts/constants.go`: the protocol's version, its
 * timings and its close codes, the link's timings.
 */
export const goConstants: Readonly<Record<string, number>> = {
  ProtocolVersion: PROTOCOL_VERSION,
  HeartbeatSeconds: HEARTBEAT_SECONDS,
  OfflineAfterSeconds: OFFLINE_AFTER_SECONDS,
  CloseUnauthorized: RUNNER_WS_CLOSE.unauthorized,
  CloseReplaced: RUNNER_WS_CLOSE.replaced,
  CloseUpdateRequired: RUNNER_WS_CLOSE.updateRequired,
  LinkCodeTtlSeconds: LINK_CODE_TTL_SECONDS,
  LinkPollSeconds: LINK_POLL_SECONDS,
  LinkAttemptsPerMinute: LINK_ATTEMPTS_PER_MINUTE,
};
