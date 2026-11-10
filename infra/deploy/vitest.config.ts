import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/infra/deploy',
  test: {
    name: 'deploy',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
