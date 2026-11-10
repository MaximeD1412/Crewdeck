import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/coverage', '**/generated', '**/*.timestamp*', 'design/**', '.nx/**'],
  },
  {
    files: ['**/*.ts', '**/*.js'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            { sourceTag: 'scope:contracts', onlyDependOnLibsWithTags: [] },
            { sourceTag: 'scope:sdk', onlyDependOnLibsWithTags: ['scope:contracts'] },
            { sourceTag: 'scope:skin', onlyDependOnLibsWithTags: ['scope:sdk'] },
            { sourceTag: 'scope:web', onlyDependOnLibsWithTags: ['scope:sdk', 'scope:contracts', 'scope:skin'] },
            { sourceTag: 'scope:server', onlyDependOnLibsWithTags: ['scope:contracts'] },
            { sourceTag: 'scope:runner', onlyDependOnLibsWithTags: ['scope:contracts'] },
          ],
        },
      ],
    },
  },
  {
    // The projects' configs extend this one through a relative import.
    files: ['**/eslint.config.js'],
    rules: { '@nx/enforce-module-boundaries': 'off' },
  },
];
