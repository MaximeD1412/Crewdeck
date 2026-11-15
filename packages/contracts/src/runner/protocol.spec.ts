import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HEARTBEAT_SECONDS,
  OFFLINE_AFTER_SECONDS,
  PROTOCOL_VERSION,
  RUNNER_WS_CLOSE,
  zHello,
  zHelloRejected,
  zMcpServers,
  zRunnerToServer,
  zServerToRunner,
} from '../index.js';

const FIXTURES = join(import.meta.dirname, '../../fixtures/runner');
const fixture = (type: string): unknown => JSON.parse(readFileSync(join(FIXTURES, `${type}.json`), 'utf8'));
const typesOf = (union: { options: readonly { shape: { type: { value: string } } }[] }): string[] => union.options.map((option) => option.shape.type.value);

const RUNNER_TO_SERVER = typesOf(zRunnerToServer);
const SERVER_TO_RUNNER = typesOf(zServerToRunner);

describe('the Runner protocol', () => {
  it('speaks version 1, a heartbeat every 15 s, offline after 45 s', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(HEARTBEAT_SECONDS).toBe(15);
    expect(OFFLINE_AFTER_SECONDS).toBe(45);
    expect(RUNNER_WS_CLOSE).toEqual({ unauthorized: 4401, replaced: 4409, updateRequired: 4426 });
  });

  it('has one fixture per message, and no other', () => {
    const files = readdirSync(FIXTURES)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.replace(/\.json$/, ''));
    expect(files.sort()).toEqual([...RUNNER_TO_SERVER, ...SERVER_TO_RUNNER].sort());
  });

  it.each(RUNNER_TO_SERVER)('accepts the fixture of %s, Runner to server', (type) => {
    expect(zRunnerToServer.parse(fixture(type))).toEqual(fixture(type));
  });

  it.each(SERVER_TO_RUNNER)('accepts the fixture of %s, server to Runner', (type) => {
    expect(zServerToRunner.parse(fixture(type))).toEqual(fixture(type));
  });

  it('refuses a message without its envelope, or with a type of the other direction', () => {
    const withoutId: Record<string, unknown> = { ...(fixture('heartbeat') as object) };
    delete withoutId.id;
    expect(zRunnerToServer.safeParse(withoutId).success).toBe(false);
    expect(zRunnerToServer.safeParse({ ...(fixture('heartbeat') as object), at: 'yesterday' }).success).toBe(false);
    expect(zRunnerToServer.safeParse(fixture('heartbeat.ack')).success).toBe(false);
    expect(zServerToRunner.safeParse(fixture('hello')).success).toBe(false);
  });

  it('refuses a hello from a system the Runner is not built for, or without its version', () => {
    const hello = fixture('hello') as Record<string, unknown>;
    expect(zHello.safeParse({ ...hello, os: 'windows' }).success).toBe(false);
    expect(zHello.safeParse({ ...hello, arch: '386' }).success).toBe(false);
    expect(zHello.safeParse({ ...hello, protocolVersion: 1.5 }).success).toBe(false);
    expect(zHello.safeParse({ ...hello, runnerVersion: '' }).success).toBe(false);
  });

  it('rejects a hello for one of its three reasons only, latestVersion optional', () => {
    const rejected = fixture('hello.rejected') as Record<string, unknown>;
    const withoutLatest = { ...rejected };
    delete withoutLatest.latestVersion;
    expect(zHelloRejected.parse({ ...withoutLatest, reason: 'revoked' })).toMatchObject({ reason: 'revoked' });
    expect(zHelloRejected.safeParse({ ...rejected, reason: 'expired' }).success).toBe(false);
  });

  it('refuses a step.verdict without its StepRun, or with a status other than passed or incomplete', () => {
    const message = fixture('step.verdict') as { verdict: object };
    const withoutStepRun: Record<string, unknown> = { ...message };
    delete withoutStepRun.stepRunId;
    expect(zRunnerToServer.safeParse(withoutStepRun).success).toBe(false);
    expect(zRunnerToServer.safeParse({ ...message, verdict: { ...message.verdict, status: 'failed' } }).success).toBe(false);
  });

  it('refuses an mcp.servers with a name outside the regex, an unknown transport, or more than 100 servers', () => {
    const message = fixture('mcp.servers') as { servers: Record<string, unknown>[] };
    const [server] = message.servers;
    for (const name of ['Stitch', 'a'.repeat(41), '', 'my server']) {
      expect(zMcpServers.safeParse({ ...message, servers: [{ ...server, name }] }).success).toBe(false);
    }
    expect(zMcpServers.parse({ ...message, servers: [{ ...server, name: 'a'.repeat(40) }] }).servers).toHaveLength(1);
    expect(zMcpServers.safeParse({ ...message, servers: [{ ...server, transport: 'sse' }] }).success).toBe(false);
    expect(zMcpServers.safeParse({ ...message, servers: [{ ...server, toolCount: -1 }] }).success).toBe(false);
    expect(zMcpServers.safeParse({ ...message, servers: Array.from({ length: 101 }, (_, i) => ({ ...server, name: `s${i}` })) }).success).toBe(false);
  });

  it('carries no command, URL, header nor env value of a Serveur MCP', () => {
    const message = fixture('mcp.servers') as { servers: Record<string, unknown>[] };
    const parsed = zMcpServers.parse({ ...message, servers: [{ ...message.servers[0], command: 'npx', env: { API_KEY: 's3cr3t' }, url: 'https://x' }] });
    expect(Object.keys(parsed.servers[0]).sort()).toEqual(['name', 'state', 'toolCount', 'transport']);
  });
});
