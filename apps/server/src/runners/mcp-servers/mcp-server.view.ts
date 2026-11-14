import type { McpServer, McpServers } from '@crewdeck/contracts';
import type { McpServerState, McpTransport } from '../../generated/prisma/client.js';

/** What of a `mcp_servers` row the page sees: an item of `GET /api/mcp-servers`, the `mcp-server` slice, the payload of `mcp-server.upserted`. */
export const MCP_SERVER_VIEW = {
  id: true,
  name: true,
  transport: true,
  state: true,
  toolCount: true,
  reportedAt: true,
} as const;

interface McpServerRow {
  id: string;
  name: string;
  transport: McpTransport;
  state: McpServerState;
  toolCount: number | null;
  reportedAt: Date;
}

export const toMcpServer = (row: McpServerRow): McpServer => ({
  id: row.id,
  name: row.name,
  transport: row.transport,
  state: row.state,
  toolCount: row.toolCount,
  reportedAt: row.reportedAt.toISOString(),
});

/** A reported server as a row stores it: its name, transport, state and count, never more of what a Runner would send. */
type Reported = Pick<McpServers['servers'][number], 'name' | 'transport' | 'state' | 'toolCount'>;

/**
 * What a `mcp.servers` message changes in the Pilote's `rows`: the servers to
 * write (`id` the row's, `undefined` for a new name), only those new or whose
 * transport, state or count moved; and the ids of the rows the Runner no
 * longer reports. A name reported twice keeps its last.
 */
export const reconcile = (
  rows: readonly Pick<McpServerRow, 'id' | 'name' | 'transport' | 'state' | 'toolCount'>[],
  reported: readonly Reported[],
): { upserts: { id: string | undefined; server: Reported }[]; removed: string[] } => {
  const byName = new Map(reported.map(({ name, transport, state, toolCount }) => [name, { name, transport, state, toolCount }]));
  const existing = new Map(rows.map((row) => [row.name, row]));
  const upserts = [...byName.values()].flatMap((server) => {
    const row = existing.get(server.name);
    const same = row && row.transport === server.transport && row.state === server.state && row.toolCount === server.toolCount;
    return same ? [] : [{ id: row?.id, server }];
  });
  return { upserts, removed: rows.filter((row) => !byName.has(row.name)).map((row) => row.id) };
};
