import { type McpServers, zMcpServer } from '@crewdeck/contracts';
import { reconcile, toMcpServer } from './mcp-server.view.js';

type Reported = McpServers['servers'];

const AT = new Date('2026-11-11T08:00:00.000Z');
const row = (id: string, name: string, fields: Partial<{ transport: 'stdio' | 'http'; state: 'ready' | 'failed'; toolCount: number | null }> = {}) => ({
  id,
  name,
  transport: 'stdio' as const,
  state: 'ready' as const,
  toolCount: 12,
  reportedAt: AT,
  ...fields,
});

describe('a mcp_servers row', () => {
  it('is the zMcpServer the page reads', () => {
    expect(zMcpServer.parse(toMcpServer(row('019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c01', 'stitch')))).toEqual({
      id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c01',
      name: 'stitch',
      transport: 'stdio',
      state: 'ready',
      toolCount: 12,
      reportedAt: '2026-11-11T08:00:00.000Z',
    });
  });
});

describe('reconcile', () => {
  const rows = [row('a', 'figma', { transport: 'http', toolCount: 4 }), row('b', 'stitch'), row('c', 'linear')];

  it('keeps an unchanged server, changes the one whose state or count moved, adds the new one and removes the absent', () => {
    const reported: Reported = [
      { name: 'figma', transport: 'http', state: 'ready', toolCount: 4 },
      { name: 'stitch', transport: 'stdio', state: 'failed', toolCount: null },
      { name: 'sentry', transport: 'http', state: 'ready', toolCount: 3 },
    ];

    const { upserts, removed } = reconcile(rows, reported);

    expect(upserts).toEqual([
      { id: 'b', server: { name: 'stitch', transport: 'stdio', state: 'failed', toolCount: null } },
      { id: undefined, server: { name: 'sentry', transport: 'http', state: 'ready', toolCount: 3 } },
    ]);
    expect(removed).toEqual(['c']);
  });

  it('removes every row when the Runner reports none, and changes nothing when it reports the same', () => {
    expect(reconcile(rows, [])).toEqual({ upserts: [], removed: ['a', 'b', 'c'] });
    expect(reconcile(rows, rows.map(({ name, transport, state, toolCount }) => ({ name, transport, state, toolCount })))).toEqual({ upserts: [], removed: [] });
  });

  it('keeps the last of a name reported twice', () => {
    const { upserts } = reconcile([], [
      { name: 'stitch', transport: 'stdio', state: 'failed', toolCount: null },
      { name: 'stitch', transport: 'stdio', state: 'ready', toolCount: 2 },
    ]);

    expect(upserts).toEqual([{ id: undefined, server: { name: 'stitch', transport: 'stdio', state: 'ready', toolCount: 2 } }]);
  });

  it('keeps of a server its name, transport, state and count: what else a Runner would send is dropped (risk SEC-13)', () => {
    const leaky = [{ name: 'stitch', transport: 'stdio', state: 'ready', toolCount: 1, env: { API_KEY: 's3cr3t' } }] as unknown as Reported;

    expect(JSON.stringify(reconcile([], leaky))).not.toContain('s3cr3t');
  });
});
