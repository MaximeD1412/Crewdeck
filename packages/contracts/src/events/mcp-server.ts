import { type McpServer, zMcpServer } from '../api/mcp-servers.js';
import { registerEventPayload } from './index.js';

/**
 * `mcp-server.upserted`: the Serveur MCP as `GET /api/mcp-servers` lists it,
 * on each `mcp.servers` that adds or changes it; `mcp-server.removed` when
 * the Runner no longer reports it.
 */
export const zMcpServerEventPayload = registerEventPayload('mcp-server', zMcpServer);

declare module './index.js' {
  interface EventPayloads {
    'mcp-server': McpServer;
  }
}
