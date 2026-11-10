import base from '../../eslint.config.js';

/** Where the raw client may be used (ADR 0008): the scope itself, auth, the webhooks, the test scenarios, its own module. */
const UNSCOPED_ALLOWED = ['src/scope/**', 'src/auth/**', 'src/github/webhooks/**', 'src/testing/**', 'src/prisma/**'];

const UNSCOPED_MESSAGE =
  'prisma.unscoped skips the scope of a Pilote (ADR 0008): use prisma.scoped, inside runInPilotScope for a webhook or a job. Allowed only in src/scope/, src/auth/, src/github/webhooks/ (and src/testing/).';

export default [
  ...base,
  {
    files: ['src/**/*.ts'],
    ignores: UNSCOPED_ALLOWED,
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'MemberExpression[property.name="unscoped"]', message: UNSCOPED_MESSAGE },
        { selector: 'ObjectPattern > Property[key.name="unscoped"]', message: UNSCOPED_MESSAGE },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/generated/prisma/client', '**/generated/prisma/client.js'],
              importNames: ['PrismaClient'],
              message: `A raw PrismaClient skips the scope of a Pilote: inject PrismaService and use prisma.scoped. ${UNSCOPED_MESSAGE}`,
            },
          ],
        },
      ],
    },
  },
];
