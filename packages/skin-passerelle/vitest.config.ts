import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/skin-passerelle',
  ssr: { resolve: { conditions: ['@crewdeck/source', ...defaultServerConditions] } },
  test: {
    name: 'skin-passerelle',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
