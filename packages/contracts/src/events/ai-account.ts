import { type AiAccount, zAiAccount } from '../api/ai-accounts.js';
import { registerEventPayload } from './index.js';

/** `ai-account.upserted`: the Compte IA as `GET /api/ai-accounts` lists it, on each `capabilities` that changes it. */
export const zAiAccountEventPayload = registerEventPayload('ai-account', zAiAccount);

declare module './index.js' {
  interface EventPayloads {
    'ai-account': AiAccount;
  }
}
