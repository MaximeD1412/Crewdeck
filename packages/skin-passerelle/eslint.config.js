import root from '../../eslint.config.js';

const SKIN_IMPORTS =
  'A Skin imports only @crewdeck/sdk, lit, @fontsource/* and its own files (ADR 0006): what it needs from the contracts comes through the SDK.';

/**
 * Everything but the SDK, Lit, the fonts and a relative path that climbs at
 * most one level (`./x`, `../x`): a deeper `../../` leaves the package.
 */
const FORBIDDEN = '^(?!(@crewdeck/sdk|lit(/.*)?|@fontsource/[^/]+(/.*)?|\\.\\.?/(?!.*\\.\\./).*)$)';

export default [
  ...root,
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: FORBIDDEN, message: SKIN_IMPORTS }] },
      ],
    },
  },
];
