import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/sdk',
  ssr: { resolve: { conditions: ['@crewdeck/source', ...defaultServerConditions] } },
  test: {
    name: 'sdk',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
