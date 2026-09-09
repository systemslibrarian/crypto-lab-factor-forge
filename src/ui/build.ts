/**
 * Build identity, injected by Vite at build time (see `define` in vite.config.ts).
 *
 * A displayed result is only attributable if you know which code produced it, and
 * on a static Pages deploy there is no server to ask. So the commit, the version
 * and the build timestamp are compiled into the bundle and travel with every
 * exported run.
 */

declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILT_AT__: string;

export const BUILD = {
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev',
  commit: typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'unknown',
  builtAt: typeof __APP_BUILT_AT__ === 'string' ? __APP_BUILT_AT__ : 'unknown',
} as const;

/** Short human form for the footer and for exported runs. */
export function buildLabel(): string {
  return `v${BUILD.version} · ${BUILD.commit.slice(0, 7)} · built ${BUILD.builtAt}`;
}
