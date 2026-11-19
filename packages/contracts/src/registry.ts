import type { z } from 'zod';
import { zApproveDevice, zDeviceHolders, zPendingDevice } from './api/devices.js';
import { zErrorEnvelope } from './api/errors.js';
import { zHealth } from './api/health.js';
import { zRunnerLatest } from './api/runner.js';
import { LINK_ATTEMPTS_PER_MINUTE, LINK_CODE_TTL_SECONDS, LINK_POLL_SECONDS, zRunnerLinkAccepted, zRunnerLinkPairing, zRunnerLinkRequest, zRunnerLinkStatus } from './api/runner-link.js';
import { CAPABILITIES_EVERY_SECONDS, zCapabilities } from './runner/capabilities.js';
import { zEngineEvent } from './runner/events.js';
import { zHeartbeat, zHeartbeatAck } from './runner/heartbeat.js';
import { zHello, zHelloAccepted, zHelloRejected } from './runner/hello.js';
import { zMcpServers } from './runner/mcp.js';
import { zGitHubChanged, zMirrorLive, zMirrorProjects, zMirrorResync, zMirrorToken, zMirrorTokenFailed, zMirrorTokenIssued } from './runner/mirror.js';
import { zSessionAnswered, zSessionResume, zSessionStart, zSessionStateMessage, zSessionStop, zSessionWaiting } from './runner/session.js';
import { zSessionInputPayload } from './runner/inputs.js';
import { zRelay, zSessionInput, zSessionKeys, zSessionReplay } from './runner/relay.js';
import { zStepVerdict } from './runner/step.js';
import { zCommandKeys, zCommandOutput, zCommandOutputChunk, zCommandReplay, zCommandRun, zCommandStarted, zCommandStop, zCommandVerdict } from './runner/command.js';
import { zProcessSealedPayload } from './process/definition.js';
import { USAGE_EVERY_SECONDS, zUsage, zUsageAck } from './runner/usage.js';
import { zVaultRotated, zVaultRotationPending } from './runner/vault.js';
import { zVault, zVaultItems, zVaultRotation, zVaultState } from './api/vault.js';
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
  { name: 'runner-pending-device', schema: zPendingDevice },
  { name: 'runner-approve-device', schema: zApproveDevice },
  { name: 'runner-device-holders', schema: zDeviceHolders },
  { name: 'runner-envelope', schema: zRunnerEnvelope },
  { name: 'runner-hello', schema: zHello },
  { name: 'runner-hello-accepted', schema: zHelloAccepted },
  { name: 'runner-hello-rejected', schema: zHelloRejected },
  { name: 'runner-heartbeat', schema: zHeartbeat },
  { name: 'runner-heartbeat-ack', schema: zHeartbeatAck },
  { name: 'runner-error', schema: zProtocolError },
  { name: 'runner-step-verdict', schema: zStepVerdict },
  { name: 'runner-capabilities', schema: zCapabilities },
  { name: 'runner-mcp-servers', schema: zMcpServers },
  { name: 'runner-github-changed', schema: zGitHubChanged },
  { name: 'runner-mirror-resync', schema: zMirrorResync },
  { name: 'runner-mirror-live', schema: zMirrorLive },
  { name: 'runner-mirror-projects', schema: zMirrorProjects },
  { name: 'runner-mirror-token', schema: zMirrorToken },
  { name: 'runner-mirror-token-issued', schema: zMirrorTokenIssued },
  { name: 'runner-mirror-token-failed', schema: zMirrorTokenFailed },
  { name: 'runner-session-start', schema: zSessionStart },
  { name: 'runner-session-stop', schema: zSessionStop },
  { name: 'runner-session-resume', schema: zSessionResume },
  { name: 'runner-session-state', schema: zSessionStateMessage },
  { name: 'runner-session-waiting', schema: zSessionWaiting },
  { name: 'runner-session-answered', schema: zSessionAnswered },
  { name: 'runner-session-replay', schema: zSessionReplay },
  { name: 'runner-session-input', schema: zSessionInput },
  { name: 'runner-session-keys', schema: zSessionKeys },
  { name: 'runner-relay', schema: zRelay },
  { name: 'runner-command-run', schema: zCommandRun },
  { name: 'runner-command-stop', schema: zCommandStop },
  { name: 'runner-command-started', schema: zCommandStarted },
  { name: 'runner-command-verdict', schema: zCommandVerdict },
  { name: 'runner-command-replay', schema: zCommandReplay },
  { name: 'runner-command-keys', schema: zCommandKeys },
  { name: 'runner-command-output', schema: zCommandOutput },
  // The plaintext of a chunk of a Commande's output, which the Runner seals.
  { name: 'command-output-chunk', schema: zCommandOutputChunk },
  // The plaintext of a Process version's sealed part, once the Runner opened it (RUNNER-18).
  { name: 'process-sealed', schema: zProcessSealedPayload },
  { name: 'runner-usage', schema: zUsage },
  { name: 'runner-usage-ack', schema: zUsageAck },
  // The vault key's rotation (E2E-4): its messages, and the Runner's HTTP routes.
  { name: 'runner-vault-rotation-pending', schema: zVaultRotationPending },
  { name: 'runner-vault-rotated', schema: zVaultRotated },
  { name: 'runner-vault', schema: zVault },
  { name: 'runner-vault-items', schema: zVaultItems },
  { name: 'runner-vault-rotation', schema: zVaultRotation },
  { name: 'runner-vault-state', schema: zVaultState },
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

export const goUnions: readonly GoUnion[] = [goUnion('engine-event', 'kind', zEngineEvent), goUnion('session-input', 'kind', zSessionInputPayload)];

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
  UsageEverySeconds: USAGE_EVERY_SECONDS,
};
