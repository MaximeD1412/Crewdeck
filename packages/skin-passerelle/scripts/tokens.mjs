/**
 * `nx run skin-passerelle:tokens`: writes `src/tokens.css` from
 * `design/tokens.json` (DTCG, generated from `design/DESIGN.md`), every token
 * as `--cd-<name>` on `:root`, with the same names and values as the mockups'
 * `design/tokens.css`. The output is committed; `src/tokens.spec.ts` fails when
 * it is out of date. `design/` is read here, at build time, never at run time.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HEADER = '/* Generated from design/tokens.json by `nx run skin-passerelle:tokens`: do not edit. */';
const ROOT_FONT_PX = 16;
/** A radius of 9999px means « fully rounded »: kept in px. */
const FULL_PX = 9999;

const round = (n) => String(Number(n.toFixed(4)));

const hexByte = (unit) => Math.round(unit * 255).toString(16).padStart(2, '0');

const color = ({ hex, alpha }) => (alpha === undefined || alpha === 1 ? hex : `${hex}${hexByte(alpha)}`);

const length = ({ value, unit }) => {
  if (unit !== 'px' || value >= FULL_PX) return `${round(value)}${unit}`;
  return `${round(value / ROOT_FONT_PX)}rem`;
};

const px = ({ value, unit }) => `${round(value)}${unit}`;

const entries = (group) => Object.entries(group ?? {}).filter(([key]) => !key.startsWith('$'));

/** Each token as `[name, value]`, in the order of design/tokens.json. */
const declarations = (tokens) => [
  ...entries(tokens.color).map(([name, token]) => [name, color(token.$value)]),
  ...entries(tokens.radius).map(([name, token]) => [name === 'DEFAULT' ? 'radius' : `radius-${name}`, length(token.$value)]),
  ...entries(tokens.spacing).map(([name, token]) => [name, length(token.$value)]),
  ...entries(tokens.typography).flatMap(([name, { $value: type }]) => [
    [`font-${name}-family`, type.fontFamily.join(', ')],
    [`font-${name}-size`, px(type.fontSize)],
    [`font-${name}-weight`, String(type.fontWeight)],
    [`font-${name}-line-height`, px(type.lineHeight)],
    ...(type.letterSpacing
      ? [[`font-${name}-letter-spacing`, `${round(type.letterSpacing.value / type.fontSize.value)}em`]]
      : []),
  ]),
];

/** The names of the tokens, without the `--cd-` prefix. */
export const tokenNames = (tokens) => declarations(tokens).map(([name]) => name);

export const renderTokensCss = (tokens) =>
  [HEADER, ':root {', ...declarations(tokens).map(([name, value]) => `  --cd-${name}: ${value};`), '}', ''].join('\n');

if (import.meta.main) {
  const packageRoot = join(import.meta.dirname, '..');
  const tokens = JSON.parse(readFileSync(join(packageRoot, '../../design/tokens.json'), 'utf8'));
  writeFileSync(join(packageRoot, 'src/tokens.css'), renderTokensCss(tokens));
}
