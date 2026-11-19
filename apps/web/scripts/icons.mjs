// Renders public/icons/icon.svg to the PNGs the manifest and iOS read (ATOI-4).
// Run after changing the SVG: `node apps/web/scripts/icons.mjs`; commit the PNGs.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const ICONS = join(import.meta.dirname, '../public/icons');
const SIZES = { 'icon-192.png': 192, 'icon-512.png': 512, 'apple-touch-icon.png': 180 };

const svg = readFileSync(join(ICONS, 'icon.svg'), 'utf8');
for (const [name, size] of Object.entries(SIZES)) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(ICONS, name), png);
}
