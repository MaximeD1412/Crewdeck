import type { z } from 'zod';
import { runnerMessage } from './envelope.js';

/** Runner → server, every `HEARTBEAT_SECONDS`: the Runner is « en ligne » while they come. */
export const zHeartbeat = runnerMessage('heartbeat');
export type Heartbeat = z.infer<typeof zHeartbeat>;

/** Server → Runner, the answer to each `heartbeat`. */
export const zHeartbeatAck = runnerMessage('heartbeat.ack');
export type HeartbeatAck = z.infer<typeof zHeartbeatAck>;
