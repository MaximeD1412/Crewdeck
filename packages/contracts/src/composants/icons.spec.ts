import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICON_NAMES, zIconName } from './icons.js';

const componentsJs = readFileSync(join(import.meta.dirname, '../../../../design/components.js'), 'utf8');

/** The keys of the `P` map of the mockups' library. */
const drawnIcons = (): string[] => {
  const start = componentsJs.indexOf('const P = {');
  const block = componentsJs.slice(start, componentsJs.indexOf('};', start));
  return [...block.matchAll(/^\s+"?([a-z-]+)"?: '/gm)].map(([, name]) => name as string);
};

describe('IconName', () => {
  it('names every icon of design/components.js, and only them', () => {
    const drawn = drawnIcons();
    expect(drawn.length).toBeGreaterThan(50);
    expect([...ICON_NAMES].sort()).toEqual(drawn.sort());
  });

  it('is a named enum', () => {
    expect(zIconName.parse('wifi')).toBe('wifi');
    expect(() => zIconName.parse('licorne')).toThrow();
    expect(zIconName.meta()?.title).toBe('IconName');
  });
});
