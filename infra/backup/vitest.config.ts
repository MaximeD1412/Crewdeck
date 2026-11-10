import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/infra/backup',
  test: {
    name: 'backup',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
