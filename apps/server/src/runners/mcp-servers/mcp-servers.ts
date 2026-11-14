import { type McpServer, type McpServers as McpServersMessage, zMcpServerList } from '@crewdeck/contracts';
import { Controller, Get, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { newId } from '../../ids.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EventsWriter } from '../../realtime/events.writer.js';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../../realtime/state-contributors.js';
import { Transactions, type Tx } from '../../realtime/transactions.js';
import { RunnerClock } from '../clock.js';
import { RunnerDispatcher } from '../runner-dispatcher.js';
import { MCP_SERVER_VIEW, reconcile, toMcpServer } from './mcp-server.view.js';

export class McpServerListDto extends createZodDto(zMcpServerList) {}

/** The Pilote's Serveurs MCP (scoped by `tx`), by name. */
const listServers = async (tx: Pick<Tx, 'mcpServer'>): Promise<McpServer[]> =>
  (await tx.mcpServer.findMany({ select: MCP_SERVER_VIEW, orderBy: { name: 'asc' } })).map(toMcpServer);

/**
 * The Serveurs MCP declared on the Pilote's Runner (US-73, RUNNER-16, ADR
 * 0013): each `mcp.servers` message replaces the Pilote's set in one
 * transaction, `mcp-server.upserted` for each server new or changed (its
 * transport, state or count), `mcp-server.removed` for each one no longer
 * reported. The message carries names, transports, states and counts, and a
 * row has no column for more: the command, address and secrets stay on the
 * Runner (risk SEC-13).
 */
@Injectable()
export class McpServers implements OnModuleInit {
  constructor(
    private readonly dispatcher: RunnerDispatcher,
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly clock: RunnerClock,
  ) {}

  onModuleInit(): void {
    this.dispatcher.registerRunnerHandler('mcp.servers', (message, context) => this.record(context.pilotId, message.servers));
  }

  /** Replaces the Pilote's Serveurs MCP by the set their Runner reported. */
  record(pilotId: string, servers: McpServersMessage['servers']): Promise<void> {
    const reportedAt = this.clock.now();
    return this.transactions.run(async (tx) => {
      const rows = await tx.mcpServer.findMany({ select: { id: true, name: true, transport: true, state: true, toolCount: true }, orderBy: { name: 'asc' } });
      const { upserts, removed } = reconcile(rows, servers);
      for (const id of removed) {
        await tx.mcpServer.delete({ where: { id } });
        await this.events.write(tx, pilotId, 'mcp-server.removed', { id });
      }
      for (const { id, server } of upserts) {
        const data = { ...server, reportedAt };
        const row = id
          ? await tx.mcpServer.update({ where: { id }, data, select: MCP_SERVER_VIEW })
          : await tx.mcpServer.create({ data: { id: newId(), pilotId, ...data }, select: MCP_SERVER_VIEW });
        await this.events.write(tx, pilotId, 'mcp-server.upserted', toMcpServer(row));
      }
    });
  }
}

/** `GET /api/mcp-servers`: the Serveurs MCP the Pilote's Runner last reported, by name. */
@Controller('mcp-servers')
export class McpServersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The Serveurs MCP of the Pilote’s Runner.', type: McpServerListDto })
  async list(): Promise<{ items: McpServer[] }> {
    return { items: await listServers(this.prisma.scoped) };
  }
}

/** The `mcp-server` slice of `GET /api/state`: the same list. */
@Injectable()
export class McpServerState implements StateContributor<'mcp-server'>, OnModuleInit {
  readonly key = 'mcp-server';

  constructor(@Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  snapshot(tx: Tx): Promise<McpServer[]> {
    return listServers(tx);
  }
}
