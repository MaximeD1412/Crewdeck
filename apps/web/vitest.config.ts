import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/web',
  resolve: { conditions: ['@crewdeck/source', ...defaultClientConditions] },
  test: {
    name: 'web',
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.spec.ts'],
  },
});
