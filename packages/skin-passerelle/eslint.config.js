import root from '../../eslint.config.js';

const SKIN_IMPORTS =
  'A Skin imports only @crewdeck/sdk, lit and its own files (ADR 0006): what it needs from the contracts comes through the SDK.';

export default [
  ...root,
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: '^(?!(@crewdeck/sdk|lit(/.*)?|\\.{1,2}/.*)$)', message: SKIN_IMPORTS }] },
      ],
    },
  },
];
