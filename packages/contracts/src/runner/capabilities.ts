import { z } from 'zod';
import { zEngineCapabilities } from './engines.js';
import { runnerMessage } from './envelope.js';

/**
 * Runner → server: what each Moteur can really run on this machine (US-38),
 * sent on each `hello.accepted`, after `crewdeck-runner login` or `logout`,
 * every 10 minutes, and whenever an adapter reports `auth-required` or
 * `limit-reached`. Never a credential: only the Compte IA's kind and state.
 * The server keeps one AiAccount per Moteur.
 */
export const zCapabilities = runnerMessage('capabilities', { engines: z.array(zEngineCapabilities).max(16) });
export type Capabilities = z.infer<typeof zCapabilities>;

/** How often the Runner sends its capabilities when nothing changed. */
export const CAPABILITIES_EVERY_SECONDS = 10 * 60;
