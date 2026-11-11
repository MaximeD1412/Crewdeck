import { z } from 'zod';
import { zVaultKeyWrap } from '../keys/pairing.js';
import { zId } from '../values.js';
import { runnerMessage } from './envelope.js';

/** The systems the Runner is built for (ADR 0004): Windows through WSL, which `wsl` says. */
export const RUNNER_OS = ['linux', 'darwin'] as const;
export const zRunnerOs = z.enum(RUNNER_OS);
export const RUNNER_ARCH = ['amd64', 'arm64'] as const;
export const zRunnerArch = z.enum(RUNNER_ARCH);

/**
 * Runner → server, the first message of every connection: the protocol it
 * speaks, its own version and the machine it runs on.
 */
export const zHello = runnerMessage('hello', {
  protocolVersion: z.int().positive(),
  runnerVersion: z.string().min(1),
  machine: z.string().min(1),
  os: zRunnerOs,
  arch: zRunnerArch,
  wsl: z.boolean(),
});
export type Hello = z.infer<typeof zHello>;

/**
 * Server → Runner: the connection is accepted, in `protocolVersion` (the
 * Runner's own, this one or the one before), with the Runner's wrap of the
 * current vault key (none before the first pairing).
 */
export const zHelloAccepted = runnerMessage('hello.accepted', {
  runnerId: zId,
  protocolVersion: z.int().positive(),
  vaultKeyWrap: zVaultKeyWrap.optional(),
});
export type HelloAccepted = z.infer<typeof zHelloAccepted>;

/**
 * Server → Runner, then the socket is closed: `unknown-token` and `revoked`
 * with 4401 (the Runner must be linked again), `update-required` with 4426,
 * `latestVersion` being the Runner version to update to (RUNNER-8).
 */
export const HELLO_REJECTED_REASONS = ['update-required', 'revoked', 'unknown-token'] as const;
export const zHelloRejected = runnerMessage('hello.rejected', {
  reason: z.enum(HELLO_REJECTED_REASONS),
  latestVersion: z.string().min(1).optional(),
});
export type HelloRejected = z.infer<typeof zHelloRejected>;
