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
const readsScoped = `
import type { Prisma } from '../generated/prisma/client.js';
export type Where = Prisma.PilotWhereInput;
export const all = (prisma: { scoped: { pilot: { findMany(): Promise<unknown> } } }): Promise<unknown> => prisma.scoped.pilot.findMany();
`;

describe('ESLint, on prisma.unscoped', () => {
  it.each(['src/ideas/ideas.service.ts', 'src/github/app.service.ts', 'src/ideas/ideas.service.spec.ts'])(
    'refuses prisma.unscoped and the raw PrismaClient in %s',
    async (path) => {
      expect(await scopeErrors(path, readsUnscoped)).toEqual([expect.stringContaining('prisma.unscoped')]);
      expect(await scopeErrors(path, destructuresUnscoped)).toEqual([expect.stringContaining('prisma.unscoped')]);
      expect(await scopeErrors(path, importsRawClient)).toEqual([expect.stringContaining('PrismaClient')]);
    },
  );

  it.each(['src/scope/x.ts', 'src/auth/sessions.service.ts', 'src/github/webhooks/deliveries.service.ts', 'src/testing/x.ts', 'src/prisma/x.ts'])(
    'allows them in %s',
    async (path) => {
      expect(await scopeErrors(path, readsUnscoped)).toEqual([]);
      expect(await scopeErrors(path, destructuresUnscoped)).toEqual([]);
      expect(await scopeErrors(path, importsRawClient)).toEqual([]);
    },
  );

  it('allows prisma.scoped and the Prisma types anywhere', async () => {
    expect(await scopeErrors('src/ideas/ideas.service.ts', readsScoped)).toEqual([]);
  });
});
