import { defaultClientConditions, defineConfig, type Plugin } from 'vite';

/** The service worker's URL (`src/push.ts`), at the root: its scope is the whole page. */
const SERVICE_WORKER = '/sw.js';

/** In development, `/sw.js` is `src/sw.ts` as Vite serves it, a module worker (`registerServiceWorker`). */
const serviceWorkerInDev = (): Plugin => ({
  name: 'crewdeck-service-worker',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === SERVICE_WORKER) req.url = '/src/sw.ts';
      next();
    });
  },
});

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/web',
  resolve: { conditions: ['@crewdeck/source', ...defaultClientConditions] },
  plugins: [serviceWorkerInDev()],
  server: {
    port: 4200,
    strictPort: true,
    host: 'localhost',
    // xfwd: the server sees the page's origin, where `GET /api/config` puts the fake GitHub.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true, ws: true, xfwd: true },
      '/fake-github': { target: 'http://localhost:3000', changeOrigin: true, xfwd: true },
      // The Runner's install script and binaries (RUNNER-3), which the install command fetches from the page's origin;
      // `/runner` itself is the page « Runner et Comptes IA ».
      '^/runner/': { target: 'http://localhost:3000', changeOrigin: true, xfwd: true },
    },
  },
  preview: { port: 4300, host: 'localhost' },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: false,
    rollupOptions: {
      // The service worker, its own entry without import (`src/sw/handlers.ts`), at the root as one classic script.
      input: { index: 'index.html', sw: 'src/sw.ts' },
      output: { entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js') },
    },
  },
});
