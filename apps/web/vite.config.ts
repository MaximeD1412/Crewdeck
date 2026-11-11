import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/web',
  resolve: { conditions: ['@crewdeck/source', ...defaultClientConditions] },
  server: {
    port: 4200,
    strictPort: true,
    host: 'localhost',
    // xfwd: the server sees the page's origin, where `GET /api/config` puts the fake GitHub.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true, ws: true, xfwd: true },
      '/fake-github': { target: 'http://localhost:3000', changeOrigin: true, xfwd: true },
      // The Runner's install script and binaries (RUNNER-3), which the install command fetches from the page's origin.
      '/runner': { target: 'http://localhost:3000', changeOrigin: true, xfwd: true },
    },
  },
  preview: { port: 4300, host: 'localhost' },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: false,
  },
});
