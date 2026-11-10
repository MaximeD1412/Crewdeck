import { ESLint } from 'eslint';
import { join, resolve } from 'node:path';

const workspaceRoot = resolve(import.meta.dirname, '../../..');
const eslint = new ESLint({ cwd: workspaceRoot });

/** Lints `code` as if it were a source file of the Skin. */
const lint = async (code: string): Promise<string[]> => {
  const results = await eslint.lintText(code, { filePath: join(import.meta.dirname, 'probe.ts') });
  return results.flatMap((result) => result.messages).map((message) => `${message.ruleId}: ${message.message}`);
};

describe('the imports of the default Skin', () => {
  it('may be @crewdeck/sdk, lit and its own files', async () => {
    const messages = await lint(
      [
        "import { version } from '@crewdeck/sdk';",
        "import { LitElement } from 'lit';",
        "import { customElement } from 'lit/decorators.js';",
        "import '@fontsource/ibm-plex-sans/400.css';",
        "import './index.js';",
        "import '../src/index.js';",
        'export const used = [version, LitElement, customElement];',
      ].join('\n'),
    );
    expect(messages).toEqual([]);
  });

  it('fails on @crewdeck/contracts', async () => {
    const messages = await lint("import { zHealth } from '@crewdeck/contracts';\nexport const used = zHealth;\n");
    expect(messages).toContainEqual(expect.stringMatching(/^no-restricted-imports: .*ADR 0006/));
    expect(messages).toContainEqual(expect.stringMatching(/^@nx\/enforce-module-boundaries: /));
  });

  it.each(['../../apps/web/src/main.js', '../../../apps/web/src/main.js', '../../sdk/src/index.js'])(
    'fails on a relative path out of the package: %s',
    async (path) => {
      const messages = await lint(`import '${path}';\n`);
      expect(messages).toContainEqual(expect.stringMatching(/^no-restricted-imports: .*ADR 0006/));
    },
  );

  it('fails on the internals of lit-html', async () => {
    const messages = await lint("import { directive } from 'lit-html/directive.js';\nexport const used = directive;\n");
    expect(messages).toContainEqual(expect.stringMatching(/^no-restricted-imports: .*ADR 0006/));
  });
});
