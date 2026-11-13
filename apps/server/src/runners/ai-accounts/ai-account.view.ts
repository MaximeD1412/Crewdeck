import { type AiAccount, type EngineCapabilities, zAiAccountModel } from '@crewdeck/contracts';
import { z } from 'zod';
import type { AiAccountKind, AiAccountState, EngineId, Prisma } from '../../generated/prisma/client.js';

/** What of an `ai_accounts` row the page sees: an item of `GET /api/ai-accounts`, the `ai-account` slice, the payload of `ai-account.upserted`. */
export const AI_ACCOUNT_VIEW = {
  id: true,
  engine: true,
  installed: true,
  version: true,
  knownVersion: true,
  kind: true,
  state: true,
  models: true,
  reportedAt: true,
} as const;

interface AiAccountRow {
  id: string;
  engine: EngineId;
  installed: boolean;
  version: string | null;
  knownVersion: boolean;
  kind: AiAccountKind;
  state: AiAccountState;
  models: Prisma.JsonValue;
  reportedAt: Date;
}

/** The ids as the contracts spell them (`claude-code`), Prisma's enums keeping `claude_code`. */
const spelled = <T extends string>(value: string): T => value.replaceAll('_', '-') as T;
const stored = <T extends string>(value: string): T => value.replaceAll('-', '_') as T;

const zModels = z.array(zAiAccountModel);

export const toAiAccount = (row: AiAccountRow): AiAccount => ({
  id: row.id,
  engine: spelled(row.engine),
  installed: row.installed,
  version: row.version,
  knownVersion: row.knownVersion,
  kind: spelled(row.kind),
  state: spelled(row.state),
  models: zModels.parse(row.models),
  reportedAt: row.reportedAt.toISOString(),
});

/**
 * The columns of a Moteur's row from what its Runner reported: its kind and
 * state, never more of the account, and each model as `zAiAccountModel` reads
 * it (what else a Runner would send is dropped).
 */
export const rowOf = (engine: EngineCapabilities, reportedAt: Date) => ({
  engine: stored<EngineId>(engine.engine),
  installed: engine.installed,
  version: engine.version ?? null,
  knownVersion: engine.knownVersion,
  kind: stored<AiAccountKind>(engine.account.kind),
  state: stored<AiAccountState>(engine.account.state),
  models: zModels.parse(engine.models),
  reportedAt,
});
