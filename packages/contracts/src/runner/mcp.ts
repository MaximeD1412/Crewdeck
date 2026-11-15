import { z } from 'zod';
import { runnerMessage } from './envelope.js';

/** A Serveur MCP's name on the Runner (ADR 0013): lower case, digits and dashes, 40 characters at most. */
export const MCP_SERVER_NAME = /^[a-z0-9-]{1,40}$/;
export const zMcpServerName = z.string().regex(MCP_SERVER_NAME);

export const MCP_TRANSPORTS = ['stdio', 'http'] as const;
export const zMcpTransport = z.enum(MCP_TRANSPORTS);
export type McpTransport = z.infer<typeof zMcpTransport>;

/** `ready` after a test that listed its tools, `failed` after one that did not. */
export const MCP_SERVER_STATES = ['ready', 'failed'] as const;
export const zMcpServerState = z.enum(MCP_SERVER_STATES);
export type McpServerState = z.infer<typeof zMcpServerState>;

/** How many Serveurs MCP one Runner may report. */
export const MCP_SERVERS_MAX = 100;

/**
 * Runner → server: the Serveurs MCP declared on the Runner (US-73, ADR 0013),
 * sent on each `hello.accepted` and after each `crewdeck-runner mcp add`,
 * `remove` and `test`; the whole set each time. Their names, transports and
 * the last test's state and tool count only: never a command, an argument, a
 * URL, a header nor an env value, which stay on the machine (risk SEC-13).
 */
export const zMcpServers = runnerMessage('mcp.servers', {
  servers: z
    .array(
      z.object({
        name: zMcpServerName,
        transport: zMcpTransport,
        state: zMcpServerState,
        toolCount: z.int().min(0).nullable(),
      }),
    )
    .max(MCP_SERVERS_MAX),
});
export type McpServers = z.infer<typeof zMcpServers>;
