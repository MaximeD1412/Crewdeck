import { defineConfig } from 'vitest/config';

/**
 * `nx test-integration provision`: provision.sh run twice, for real, on a
 * throwaway Ubuntu 24.04 container with systemd (src/global-setup.ts). The
 * specs share that one machine, and some change it then put it back: they
 * run one file at a time.
 */
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/infra/provision-integration',
  test: {
    name: 'provision:integration',
    globals: true,
    environment: 'node',
    include: ['src/provision.*.spec.ts'],
    globalSetup: ['src/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
