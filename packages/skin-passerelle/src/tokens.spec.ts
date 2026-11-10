import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderTokensCss, tokenNames } from '../scripts/tokens.mjs';

const workspaceRoot = join(import.meta.dirname, '../../..');
const tokensJson = JSON.parse(readFileSync(join(workspaceRoot, 'design/tokens.json'), 'utf8'));
const committed = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');

describe('src/tokens.css', () => {
  it('is up to date with design/tokens.json (`nx run skin-passerelle:tokens`)', () => {
    expect(committed).toBe(renderTokensCss(tokensJson));
  });

  it('defines the accent', () => {
    expect(committed).toContain('--cd-accent: #5cc8dc;');
  });

  it('defines every token of design/tokens.json as --cd-<name> on :root', () => {
    const names = tokenNames(tokensJson);
    expect(names.length).toBeGreaterThan(50);
    for (const name of names) expect(committed, name).toMatch(new RegExp(`^  --cd-${name}: \\S`, 'm'));
  });

  it('holds the values of design/tokens.css, the mockups’ own', () => {
    const declarations = (css: string, prefix: string) =>
      [...css.matchAll(new RegExp(`^\\s*--${prefix}([\\w-]+):\\s*(.+);$`, 'gm'))].map(([, name, value]) => [name, value]);
    expect(declarations(committed, 'cd-')).toEqual(
      declarations(readFileSync(join(workspaceRoot, 'design/tokens.css'), 'utf8'), ''),
    );
  });
});
