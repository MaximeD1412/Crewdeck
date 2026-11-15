import type { z } from 'zod';
import { zErrorEnvelope } from './api/errors.js';
import { zHealth } from './api/health.js';
import { zRunnerLatest } from './api/runner.js';
import { LINK_ATTEMPTS_PER_MINUTE, LINK_CODE_TTL_SECONDS, LINK_POLL_SECONDS, zRunnerLinkAccepted, zRunnerLinkPairing, zRunnerLinkRequest, zRunnerLinkStatus } from './api/runner-link.js';
import { CAPABILITIES_EVERY_SECONDS, zCapabilities } from './runner/capabilities.js';
import { zEngineEvent } from './runner/events.js';
import { zHeartbeat, zHeartbeatAck } from './runner/heartbeat.js';
import { zHello, zHelloAccepted, zHelloRejected } from './runner/hello.js';
import { zStepVerdict } from './runner/step.js';
import { zProcessSealedPayload } from './process/definition.js';
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
  { name: 'runner-latest', schema: zRunnerLatest },
  { name: 'runner-envelope', schema: zRunnerEnvelope },
  { name: 'runner-hello', schema: zHello },
  { name: 'runner-hello-accepted', schema: zHelloAccepted },
  { name: 'runner-hello-rejected', schema: zHelloRejected },
  { name: 'runner-heartbeat', schema: zHeartbeat },
  { name: 'runner-heartbeat-ack', schema: zHeartbeatAck },
  { name: 'runner-error', schema: zProtocolError },
  { name: 'runner-step-verdict', schema: zStepVerdict },
  { name: 'runner-capabilities', schema: zCapabilities },
  // The plaintext of a Process version's sealed part, once the Runner opened it (RUNNER-18).
  { name: 'process-sealed', schema: zProcessSealedPayload },
];

/**
 * The discriminated unions the Runner reads or writes, which go-jsonschema
 * cannot type: each option is a registry entry of its own, named
 * `<name>-<discriminator value>` (Go type `EngineEventToolCall` for
 * `engine-event` and `tool-call`), and the union is a Go struct holding one
 * pointer per option, written by `contracts:generate` to `<name>.go`.
 */
export interface GoUnion {
  name: string;
  discriminator: string;
  options: readonly { value: string; schema: z.ZodObject }[];
}

const goUnion = <D extends string>(
  name: string,
  discriminator: D,
  union: { options: readonly (z.ZodObject & { shape: Record<D, z.ZodLiteral<string>> })[] },
): GoUnion => ({
  name,
  discriminator,
  options: union.options.map((schema) => ({ value: schema.shape[discriminator].value, schema })),
});

export const goUnions: readonly GoUnion[] = [goUnion('engine-event', 'kind', zEngineEvent)];

/** Every schema written as JSON Schema and Go: the registry, then each option of the unions. */
export const generatedEntries: readonly { name: string; schema: z.ZodType }[] = [
  ...registry,
  ...goUnions.flatMap((union) => union.options.map((option) => ({ name: `${union.name}-${option.value}`, schema: option.schema }))),
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
  CapabilitiesEverySeconds: CAPABILITIES_EVERY_SECONDS,
};
