import { ESLint } from 'eslint';
import { join } from 'node:path';

const serverRoot = join(import.meta.dirname, '../..');
const eslint = new ESLint({ cwd: serverRoot });

/** The messages of the scope's rules on `code`, linted as if it were the file `path` of the server. */
const scopeErrors = async (path: string, code: string): Promise<string[]> => {
  const [result] = await eslint.lintText(code, { filePath: join(serverRoot, path) });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === 'no-restricted-imports' || message.ruleId === 'no-restricted-syntax')
    .map((message) => message.message);
};

const readsUnscoped = `
export class Probe {
  constructor(private readonly prisma: { unscoped: { pilot: { findMany(): Promise<unknown> } } }) {}
  all(): Promise<unknown> {
    return this.prisma.unscoped.pilot.findMany();
  }
}
`;
const destructuresUnscoped = `
export const all = (prisma: { unscoped: unknown }): unknown => {
  const { unscoped } = prisma;
  return unscoped;
};
`;
const importsRawClient = `
import { PrismaClient } from '../generated/prisma/client.js';
export const client = new PrismaClient({} as never);
`;
const runsRawSql = `
export const raw = async (prisma: { scoped: { $queryRaw(query: TemplateStringsArray): Promise<unknown>; $executeRawUnsafe(query: string): Promise<number> } }): Promise<unknown> => {
  await prisma.scoped.$executeRawUnsafe('SELECT 1');
  return prisma.scoped.$queryRaw\`SELECT 1\`;
};
`;
const readsScoped = `
import type { Prisma } from '../generated/prisma/client.js';
export type Where = Prisma.PilotWhereInput;
export const all = (prisma: { scoped: { pilot: { findMany(): Promise<unknown> } } }): Promise<unknown> => prisma.scoped.pilot.findMany();
`;

describe('ESLint, on prisma.unscoped', () => {
  it.each(['src/ideas/ideas.service.ts', 'src/github/app.service.ts', 'src/ideas/ideas.service.spec.ts', 'src/realtime/events.replay.ts', 'src/runners/runner-presence.service.ts', 'src/runners/link/runner-links.service.ts', 'src/metrics/latency.service.ts'])(
    'refuses prisma.unscoped, the raw PrismaClient and raw SQL in %s',
    async (path) => {
      expect(await scopeErrors(path, readsUnscoped)).toEqual([expect.stringContaining('prisma.unscoped')]);
      expect(await scopeErrors(path, destructuresUnscoped)).toEqual([expect.stringContaining('prisma.unscoped')]);
      expect(await scopeErrors(path, importsRawClient)).toEqual([expect.stringContaining('PrismaClient')]);
      expect(await scopeErrors(path, runsRawSql)).toEqual([expect.stringMatching(/^Raw SQL/), expect.stringMatching(/^Raw SQL/)]);
    },
  );

  it.each(['src/scope/x.ts', 'src/auth/sessions.service.ts', 'src/github/webhooks/deliveries.service.ts', 'src/testing/x.ts', 'src/prisma/x.ts', 'src/realtime/retention.job.ts', 'src/runners/runner-sweep.job.ts', 'src/runners/link/link-lookup.ts', 'src/metrics/latency.sql.ts', 'src/metrics/latency.retention.ts', 'src/usage/usage.retention.ts', 'src/usage/fx.job.ts'])(
    'allows them in %s',
    async (path) => {
      expect(await scopeErrors(path, readsUnscoped)).toEqual([]);
      expect(await scopeErrors(path, destructuresUnscoped)).toEqual([]);
      expect(await scopeErrors(path, importsRawClient)).toEqual([]);
      expect(await scopeErrors(path, runsRawSql)).toEqual([]);
    },
  );

  it('allows prisma.scoped and the Prisma types anywhere', async () => {
    expect(await scopeErrors('src/ideas/ideas.service.ts', readsScoped)).toEqual([]);
  });
});
