import { z } from 'zod';
import { zMcpServerName, zMcpServerState, zMcpTransport } from '../runner/mcp.js';
import { zId, zInstant } from '../values.js';

/**
 * A Serveur MCP declared on the Pilote's Runner (US-73, ADR 0013), from its
 * last `mcp.servers` message: its name, transport, the state of its last test
 * and how many tools it listed then (`null` when that test failed). Its
 * command, address and secrets stay on the Runner (risk SEC-13). An item of
 * `GET /api/mcp-servers`, the payload of `mcp-server.upserted`, and the
 * `mcp-server` slice of `GET /api/state`.
 */
export const zMcpServer = z.object({
  id: zId,
  name: zMcpServerName,
  transport: zMcpTransport,
  state: zMcpServerState,
  toolCount: z.int().min(0).nullable(),
  reportedAt: zInstant,
});
export type McpServer = z.infer<typeof zMcpServer>;

/** `GET /api/mcp-servers` (session): the Serveurs MCP the Pilote's Runner last reported, by name. */
export const zMcpServerList = z.object({ items: z.array(zMcpServer) });
export type McpServerList = z.infer<typeof zMcpServerList>;
