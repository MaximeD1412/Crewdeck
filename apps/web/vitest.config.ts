import { playwright } from '@vitest/browser-playwright';
import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';

const shared = {
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/web',
  resolve: { conditions: ['@crewdeck/source', ...defaultClientConditions] },
};

export default defineConfig({
  ...shared,
  test: {
    projects: [
      {
        ...shared,
        test: {
          name: 'web',
          globals: true,
          environment: 'happy-dom',
          setupFiles: ['vitest.happy-dom.ts'],
          include: ['src/**/*.spec.ts'],
          exclude: ['src/keys/**', 'src/dialogs/**'],
        },
      },
      {
        // The end-to-end primitives run in a real Chromium: its WebCrypto is
        // what the Appareils run (ADR 0003), not Node's. The product's dialogs
        // too: a modal <dialog>, its focus and Escape as the browser has them.
        ...shared,
        test: {
          name: 'web-browser',
          globals: true,
          include: ['src/keys/**/*.spec.ts', 'src/dialogs/**/*.spec.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
