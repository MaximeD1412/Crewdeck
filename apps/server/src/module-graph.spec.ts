import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const srcRoot = import.meta.dirname;

/** The relative modules a file imports at load time: `import … from`, `export … from`, `import '…'`; never `import type` nor `import()`. */
const staticImports = (source: string): string[] => {
  const statements = /^\s*(import|export)\s+(type\s+)?([^'";]*?)\s*(?:from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm;
  return [...source.matchAll(statements)].flatMap(([, , type, specifiers = '', path = '']) => {
    if (type !== undefined) return [];
    // `import { type A, type B } from` loads nothing either.
    const names = /^\{([^}]*)\}$/.exec(specifiers.trim())?.[1];
    if (names !== undefined && names.split(',').every((name) => name.trim() === '' || name.trim().startsWith('type '))) return [];
    return [path];
  });
};

/** Every file of `src/` that loading `entry` loads, relative to `src/`. */
const graph = (entry: string): Set<string> => {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    const path = relative(srcRoot, file);
    if (seen.has(path)) return;
    seen.add(path);
    for (const imported of staticImports(readFileSync(file, 'utf8'))) {
      const target = join(dirname(file), imported.replace(/\.js$/, '.ts'));
      if (existsSync(target)) visit(target);
    }
  };
  visit(join(srcRoot, entry));
  return seen;
};

describe('the module graph of the server', () => {
  it('never loads src/testing/ from main.ts: the fakes come only through a dynamic import with CREWDECK_FAKES=1', () => {
    const loaded = graph('main.ts');

    expect([...loaded].filter((file) => file.startsWith('testing/'))).toEqual([]);
    expect(loaded).toContain('github/octokit.client.ts');
    expect(loaded).toContain('app.module.ts');
  });

  it('is walked far enough to see the fakes from the testing module', () => {
    expect(graph('testing/testing.module.ts')).toContain('testing/fake-github.ts');
  });

  it('skips what loads nothing', () => {
    expect(
      staticImports(
        [
          "import type { A } from './a.js';",
          "import { type B, type C } from './b.js';",
          "import { type D, e } from './d.js';",
          "export { f } from './f.js';",
          "import './g.js';",
          "const h = import('./h.js');",
        ].join('\n'),
      ),
    ).toEqual(['./d.js', './f.js', './g.js']);
  });
});

