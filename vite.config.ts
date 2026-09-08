import { defineConfig, configDefaults } from 'vitest/config';

// base must match the GitHub Pages project subpath:
// https://systemslibrarian.github.io/crypto-lab-factor-forge/
// Every asset reference in the page is relative or Vite-imported, so nothing
// resolves to the domain root and 404s under the subpath.
export default defineConfig({
  base: '/crypto-lab-factor-forge/',
  worker: {
    // The long factoring runs live in a module worker. Vite rewrites the
    // `new Worker(new URL(...), { type: 'module' })` call to an emitted chunk
    // whose URL is resolved against import.meta.url, so it keeps working under
    // the Pages project subpath.
    format: 'es',
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
