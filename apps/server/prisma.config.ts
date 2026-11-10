import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma does not read `.env`: the repository's one, when present, for local runs.
const dotEnv = join(import.meta.dirname, '../../.env');
if (existsSync(dotEnv)) process.loadEnvFile(dotEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` needs no database; `migrate` fails clearly without DATABASE_URL.
  datasource: { url: process.env['DATABASE_URL'] ?? '' },
});
