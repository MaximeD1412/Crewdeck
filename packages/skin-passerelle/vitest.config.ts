import { playwright } from '@vitest/browser-playwright';
import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

/** Files and imports under Node; the Composants in a real browser (ADR 0008, test baseline). */
const BROWSER_SPECS = [
  'src/composants.spec.ts',
  'src/cadre.spec.ts',
  'src/*-row.spec.ts',
  'src/capture.spec.ts',
  'src/process-track.spec.ts',
  'src/stat.spec.ts',
  'src/ticket-tree.spec.ts',
  'src/timeline.spec.ts',
  'src/usage-meter.spec.ts',
  'src/text-field.spec.ts',
  'src/controls.spec.ts',
  'src/dialog.spec.ts',
  'src/page-composants.spec.ts',
  'src/page-demarrage.spec.ts',
  'src/page-parametres.spec.ts',
  'src/session.spec.ts',
  'src/composer.spec.ts',
];

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/skin-passerelle',
  resolve: { conditions: ['@crewdeck/source'] },
  ssr: { resolve: { conditions: ['@crewdeck/source', ...defaultServerConditions] } },
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'skin-passerelle',
          environment: 'node',
          include: ['src/**/*.spec.ts'],
          exclude: BROWSER_SPECS,
        },
      },
      {
        extends: true,
        test: {
          name: 'skin-passerelle:browser',
          include: BROWSER_SPECS,
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
