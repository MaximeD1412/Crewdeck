import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Values only from the `--cd-*` tokens (UI-2): the Skin's CSS, its `css`
 * blocks and its `.css` files but the generated `tokens.css`, holds no raw
 * colour and no px length. The one px allowed is the breakpoint's, which a
 * custom property cannot give to `@media` (`BREAKPOINT_PX`).
 */
const BREAKPOINT = '@media (min-width: 1280px)';

const offences = (css: string): string[] => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '').replaceAll(BREAKPOINT, '');
  return [
    ...(stripped.match(/#[0-9a-f]{3,8}\b/gi) ?? []),
    ...(stripped.match(/\b(?:rgba?|hsla?|oklch|lab|lch)\(/gi) ?? []),
    ...(stripped.match(/\b\d*\.?\d+px\b/g) ?? []),
  ];
};

const cssBlocks = (source: string): string[] => [...source.matchAll(/\bcss`([\s\S]*?)`/g)].map(([, block]) => block ?? '');

const dir = import.meta.dirname;
const files = readdirSync(dir).filter((file) => !file.endsWith('.spec.ts') && file !== 'tokens.css');

describe('the Skin’s CSS', () => {
  it('finds a raw colour or px, the breakpoint aside', () => {
    expect(offences('a { color: #fff; margin: 4px; background: rgb(0 0 0); }')).toEqual(['#fff', 'rgb(', '4px']);
    expect(offences(`${BREAKPOINT} { a { margin: var(--cd-space-1); } }`)).toEqual([]);
  });

  it.each(files.filter((file) => file.endsWith('.ts') || file.endsWith('.css')))('%s uses only the --cd-* tokens', (file) => {
    const source = readFileSync(join(dir, file), 'utf8');
    const css = file.endsWith('.css') ? [source] : cssBlocks(source);
    expect(css.flatMap(offences)).toEqual([]);
  });
});
