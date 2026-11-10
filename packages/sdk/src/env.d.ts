/** Vite sets `import.meta.env` in the page's build and in Vitest; plain Node leaves it undefined. */
interface ImportMeta {
  readonly env?: { readonly PROD?: boolean };
}
