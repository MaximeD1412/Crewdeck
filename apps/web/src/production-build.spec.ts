import { join } from 'node:path';
import { build, type Plugin, type Rolldown } from 'vite';

// The production build of the end-to-end primitives: every export of the
// modules the page may import kept alive (entropy.ts is reached through
// crypto.ts), built with the page's Vite config in production mode, as
// `nx build web` does.
const KEYS = ['crypto', 'base32', 'bytes', 'support'];

// What only the test seam (testing.ts, entropy.ts's replacement) contains.
const SEAM_MARKERS = [
  'crewdeck/test/random',
  'withDeterministicRandom',
  'withFixedRandom',
  'the entropy is replaced only in tests',
];

const buildKeys = async (extraModules: string[] = []): Promise<string> => {
  const modules = [...KEYS, ...extraModules];
  const entry: Plugin = {
    name: 'keys-entry',
    resolveId: (id) => (id === 'virtual:keys-entry' ? '\0keys-entry' : null),
    load: (id) =>
      id === '\0keys-entry'
        ? modules.map((m, i) => `import * as m${i} from '/src/keys/${m}.ts';`).join('\n') +
          `\nglobalThis.keys = [${modules.map((_, i) => `m${i}`).join(', ')}];`
        : null,
  };
  const output = await build({
    configFile: join(import.meta.dirname, '../vite.config.ts'),
    mode: 'production',
    logLevel: 'silent',
    plugins: [entry],
    build: { write: false, rollupOptions: { input: 'virtual:keys-entry' } },
  });
  const outputs = (Array.isArray(output) ? output : [output]) as Rolldown.RolldownOutput[];
  return outputs
    .flatMap((o) => o.output)
    .map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''))
    .join('\n');
};

describe('the production build', () => {
  it('holds the primitives without the deterministic seam', async () => {
    const code = await buildKeys();
    expect(code).toContain('HPKE-v1');
    expect(code).toContain('crewdeck/v1/vault-wrap');
    for (const marker of SEAM_MARKERS) expect(code).not.toContain(marker);
  }, 60_000);

  it('would show the seam if a production module imported it', async () => {
    const code = await buildKeys(['testing']);
    expect(code).toContain('crewdeck/test/random');
  }, 60_000);
});
