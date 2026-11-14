import base from '../../eslint.config.js';

/** Where the raw client may be used (ADR 0008): the scope itself, auth, the webhooks, the test scenarios, its own module. */
const UNSCOPED_ALLOWED = ['src/scope/**', 'src/auth/**', 'src/github/webhooks/**', 'src/testing/**', 'src/prisma/**', 'src/realtime/retention.job.ts', 'src/runners/runner-sweep.job.ts', 'src/runners/link/link-lookup.ts', 'src/metrics/latency.sql.ts', 'src/metrics/latency.retention.ts', 'src/usage/usage.retention.ts', 'src/usage/fx.job.ts'];

const UNSCOPED_MESSAGE =
  'prisma.unscoped skips the scope of a Pilote (ADR 0008): use prisma.scoped, inside runInPilotScope for a webhook or a job. Allowed only in src/scope/, src/auth/, src/github/webhooks/, the retention jobs of the events, of the latency samples and of the usage measures, the conversion of the rates job, the p95 of the latency, the sweep of the Runners, the lookup of the link codes (and src/testing/).';

const RAW_SQL_MESSAGE =
  'Raw SQL skips the scope of a Pilote (ADR 0008), and prisma.scoped refuses it at run time: query a model through prisma.scoped. Allowed only on prisma.unscoped in src/scope/, src/auth/, src/github/webhooks/, the retention jobs of the events, of the latency samples and of the usage measures, the conversion of the rates job, the p95 of the latency, the sweep of the Runners, the lookup of the link codes (and src/testing/).';

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
        { selector: 'MemberExpression[property.name=/^\\$(query|execute)Raw(Unsafe)?$/]', message: RAW_SQL_MESSAGE },
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
