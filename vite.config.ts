import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, configDefaults } from 'vitest/config';

/**
 * Build identity, compiled into the bundle.
 *
 * A static Pages deploy has no server to ask "which build am I?", so an exported
 * experiment could never be attributed to the code that produced it. These three
 * values close that: they travel in every run record and every JSON export.
 * `git` may be absent (a tarball build), so each falls back rather than failing
 * the build.
 */
function gitCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// base must match the GitHub Pages project subpath:
// https://systemslibrarian.github.io/crypto-lab-factor-forge/
// Every asset reference in the page is relative or Vite-imported, so nothing
// resolves to the domain root and 404s under the subpath.
export default defineConfig({
  base: '/crypto-lab-factor-forge/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(process.env.GITHUB_SHA ?? gitCommit()),
    // Date-only: a full timestamp changes the bundle hash on every rebuild and
    // makes two otherwise-identical builds look different.
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
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
