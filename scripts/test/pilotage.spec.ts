/**
 * The console's « Pilotage » page reads `docs/pilotage/mep.json`: a migration
 * an element names must be one of the server's, or its check (a query on
 * `_prisma_migrations`) never finds it applied. A migration renamed to come
 * after develop's (a merge) must be renamed there too.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const MIGRATION_NAME = /\b\d{14}_[a-z0-9_]+\b/g;

interface MepElement {
  readonly id: string;
}

const elements = (JSON.parse(readFileSync(resolve(ROOT, 'docs/pilotage/mep.json'), 'utf8')) as { elements: MepElement[] }).elements;
const migrations = readdirSync(resolve(ROOT, 'apps/server/prisma/migrations'));

/** Each migration name an element of `mep.json` cites, with the element's id. */
const cited = elements.flatMap((element) => [...new Set(JSON.stringify(element).match(MIGRATION_NAME) ?? [])].map((name) => [element.id, name] as const));

describe('docs/pilotage/mep.json', () => {
  it('cites migrations', () => {
    expect(cited.length).toBeGreaterThan(0);
  });

  it.each(cited)('%s cites %s, a migration of apps/server/prisma/migrations', (_id, name) => {
    expect(migrations).toContain(name);
  });
});
