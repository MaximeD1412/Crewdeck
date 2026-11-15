import { eventPayloadSchema, RESOURCES, STATE_SLICES, zMcpServer, zMcpServerList } from '../index.js';

const STITCH = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c01',
  name: 'stitch',
  transport: 'stdio',
  state: 'ready',
  toolCount: 12,
  reportedAt: '2026-11-11T08:30:00.000Z',
};

describe('zMcpServer', () => {
  it('is an item of GET /api/mcp-servers, the payload of mcp-server.upserted, and the mcp-server slice', () => {
    expect(RESOURCES).toContain('mcp-server');
    expect(zMcpServerList.parse({ items: [STITCH] })).toEqual({ items: [STITCH] });
    expect(eventPayloadSchema('mcp-server.upserted')?.parse(STITCH)).toEqual(STITCH);
    expect(eventPayloadSchema('mcp-server.removed')?.parse({ id: STITCH.id })).toEqual({ id: STITCH.id });
    expect(STATE_SLICES['mcp-server'].parse([STITCH])).toEqual([STITCH]);
  });

  it('holds a name, a transport, a state and a count: a command, a URL or a secret given with it is not kept (risk SEC-13)', () => {
    const parsed = zMcpServer.parse({ ...STITCH, command: 'npx stitch-mcp', url: 'https://mcp.example/?token=t', env: { API_KEY: 's3cr3t' } });

    expect(Object.keys(parsed).sort()).toEqual(['id', 'name', 'reportedAt', 'state', 'toolCount', 'transport']);
  });

  it('is named as the Runner names it, its count null when its last test failed', () => {
    expect(zMcpServer.safeParse({ ...STITCH, name: 'Stitch' }).success).toBe(false);
    expect(zMcpServer.safeParse({ ...STITCH, transport: 'sse' }).success).toBe(false);
    expect(zMcpServer.parse({ ...STITCH, state: 'failed', toolCount: null }).toolCount).toBeNull();
  });
});
