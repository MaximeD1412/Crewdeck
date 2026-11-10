import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../node_modules/.vite/scripts',
  test: {
    name: 'scripts',
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
});
