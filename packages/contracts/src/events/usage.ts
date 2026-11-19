import { type UsageAccount, zUsageAccount } from '../api/usage.js';
import { registerEventPayload } from './index.js';

/** `usage.upserted`: the usage of a Compte IA as `GET /api/usage` lists it, on each measure or spend the Runner sends. */
export const zUsageEventPayload = registerEventPayload('usage', zUsageAccount);

declare module './index.js' {
  interface EventPayloads {
    usage: UsageAccount;
  }
}
