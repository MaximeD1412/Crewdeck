import swc from 'unplugin-swc';
import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

/** `nx test-integration server`: against a real PostgreSQL, one throwaway database per run. */
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/server-integration',
  ssr: { resolve: { conditions: ['@crewdeck/source', ...defaultServerConditions] } },
  plugins: [swc.vite({ tsconfigFile: 'tsconfig.spec.json', module: { type: 'es6' } })],
  test: {
    name: 'server:integration',
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.spec.ts'],
    globalSetup: ['test/integration/database.ts'],
    // One database for the run, which a scenario empties: one file at a time.
    fileParallelism: false,
    restoreMocks: true,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
