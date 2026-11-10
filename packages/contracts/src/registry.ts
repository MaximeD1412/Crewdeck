import type { z } from 'zod';
import { zHealth } from './api/health.js';

/**
 * The schemas `nx run contracts:generate` writes as JSON Schema and Go types
 * (`apps/runner/internal/contracts/<name>.go`). Add an entry for every schema
 * the Runner reads or writes.
 */
export const registry: readonly { name: string; schema: z.ZodType }[] = [{ name: 'health', schema: zHealth }];
