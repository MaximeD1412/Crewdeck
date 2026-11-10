import swc from 'unplugin-swc';
import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/server',
  ssr: { resolve: { conditions: ['@crewdeck/source', ...defaultServerConditions] } },
  // Nest's dependency injection reads the decorators' metadata, which esbuild does not emit.
  plugins: [swc.vite({ tsconfigFile: 'tsconfig.spec.json', module: { type: 'es6' } })],
  test: {
    name: 'server',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    restoreMocks: true,
  },
});
