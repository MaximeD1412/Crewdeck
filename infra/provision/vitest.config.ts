import { defineConfig } from 'vitest/config';

/** `nx test provision`: what needs no machine (the workflow's triggers). */
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/infra/provision',
  test: {
    name: 'provision',
    globals: true,
    environment: 'node',
    include: ['src/workflow.spec.ts'],
  },
});
