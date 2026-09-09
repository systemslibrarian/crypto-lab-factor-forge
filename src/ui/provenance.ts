/**
 * Provenance: making a displayed result attributable and a shared link
 * reproducible.
 *
 * A number on this board is a scientific claim, and a claim you cannot trace
 * back to its inputs is not a result — it is an anecdote. So every completed run
 * can be exported with the N, every bound, the seed, the build that produced it
 * and the browser it ran in; and the whole experiment can be put in a URL.
 *
 * ONE HONEST LIMIT, stated in the export itself rather than buried here. Every
 * method is capped on WALL-CLOCK time, not on steps. Replaying a seed therefore
 * reproduces the same search, and reproduces the same OUTCOME only for a run
 * that finished before its cap; a run that hit the cap will stop somewhere else
 * on faster or slower hardware. `cappedRun` records which of the two it was, so
 * the export can say so instead of promising determinism it cannot deliver.
 */

import { DEFAULT_PARAMS, type Params } from '../factor/types';
import { BUILD } from './build';
import { state, type RunRecord } from './state';

/** Short URL keys, so a 40-digit N plus ten bounds still fits comfortably. */
const PARAM_KEYS: Record<keyof Params, string> = {
  trialBound: 'tb',
  fermatSteps: 'fs',
  rhoSteps: 'rs',
  smoothBound: 'b1',
  ecmB1: 'e1',
  ecmB2: 'e2',
  ecmCurves: 'ec',
  qsFactorBaseBound: 'qb',
  qsSieveRadius: 'qm',
};

/**
 * Encode the live experiment as a URL. Only values that DIFFER from the defaults
 * are written, so the common link stays short and a future change of default
 * cannot silently rewrite someone's saved experiment (the ones they changed are
 * pinned; the ones they never touched follow the app).
 */
export function permalinkFor(): string {
  const url = new URL(window.location.href);
  url.hash = '';
  url.search = '';
  const q = url.searchParams;
  q.set('n', String(state.n));
  for (const [key, short] of Object.entries(PARAM_KEYS) as [keyof Params, string][]) {
    if (state.params[key] !== DEFAULT_PARAMS[key]) q.set(short, String(state.params[key]));
  }
  if (state.capMs !== 8000) q.set('cap', String(state.capMs));
  const tab = document.querySelector('.tab-btn[aria-selected="true"]');
  const panel = tab instanceof HTMLElement ? tab.dataset.panel : null;
  if (panel && panel !== 'race') q.set('tab', panel);
  return url.toString();
}

export interface RestoredState {
  n: bigint | null;
  params: Partial<Params>;
  capMs: number | null;
  tab: string | null;
  /** Inputs that were present but unusable, so the page can say so. */
  rejected: string[];
}

/**
 * Read an experiment out of the URL.
 *
 * Everything is validated against the same ranges the parameter controls
 * enforce. A shared link is untrusted input: a `rhoSteps` of 1e12 from a URL
 * would hang the tab exactly as surely as one typed by hand, and silently
 * clamping it would make the link mean something different from what it says.
 * Rejected values are reported, not swallowed.
 */
export function restoreFromUrl(limits: Record<string, { min: number; max: number }>): RestoredState {
  const q = new URL(window.location.href).searchParams;
  const rejected: string[] = [];
  let n: bigint | null = null;
  const raw = q.get('n');
  if (raw !== null) {
    if (/^\d{1,40}$/.test(raw) && BigInt(raw) >= 2n) n = BigInt(raw);
    else rejected.push(`n=${raw.slice(0, 48)}`);
  }
  const params: Partial<Params> = {};
  for (const [key, short] of Object.entries(PARAM_KEYS) as [keyof Params, string][]) {
    const v = q.get(short);
    if (v === null) continue;
    const num = Number(v);
    const lim = limits[key];
    if (!Number.isInteger(num) || !lim || num < lim.min || num > lim.max) {
      rejected.push(`${short}=${v.slice(0, 24)}`);
      continue;
    }
    params[key] = num;
  }
  let capMs: number | null = null;
  const cap = q.get('cap');
  if (cap !== null) {
    const num = Number(cap);
    if (Number.isInteger(num) && num >= 100 && num <= 120_000) capMs = num;
    else rejected.push(`cap=${cap.slice(0, 24)}`);
  }
  const tab = q.get('tab');
  const known = ['race', 'forge', 'trace', 'ladder', 'shor'];
  return {
    n,
    params,
    capMs,
    tab: tab && known.includes(tab) ? tab : null,
    rejected,
  };
}

export interface ExportedRun {
  schema: 'crypto-lab-factor-forge/run@1';
  build: typeof BUILD;
  environment: { userAgent: string; platform: string; hardwareConcurrency: number };
  experiment: {
    n: string;
    algorithm: string;
    params: Params;
    capMs: number;
    seed: string;
    runId: number;
  };
  result: {
    p: string | null;
    q: string | null;
    ms: number;
    /** True when the wall-clock cap stopped it — see the note on reproducibility. */
    cappedByTime: boolean;
    metrics: { key: string; value: string }[];
    gaveUp: { reason: string; at: string } | null;
  };
  /** Invariant I1: the verifier's own verdict, exported alongside the claim. */
  verdict: RunRecord['verdict'];
  why: RunRecord['outcome']['trace']['why'];
  reproducibility: string;
}

export function buildExport(rec: RunRecord): ExportedRun {
  const cappedByTime = rec.outcome.trace.gaveUp?.reason.includes('time cap') ?? false;
  const nav = navigator as Navigator & { platform?: string };
  return {
    schema: 'crypto-lab-factor-forge/run@1',
    build: BUILD,
    environment: {
      userAgent: navigator.userAgent,
      platform: nav.platform ?? 'unknown',
      hardwareConcurrency: navigator.hardwareConcurrency ?? 0,
    },
    experiment: {
      n: String(rec.ctx.n),
      algorithm: rec.ctx.algorithm,
      params: rec.ctx.params,
      capMs: rec.ctx.capMs,
      seed: rec.ctx.seed,
      runId: rec.ctx.runId,
    },
    result: {
      p: rec.outcome.p,
      q: rec.outcome.q,
      ms: rec.outcome.ms,
      cappedByTime,
      metrics: rec.outcome.trace.metrics,
      gaveUp: rec.outcome.trace.gaveUp,
    },
    verdict: rec.verdict,
    why: rec.outcome.trace.why,
    reproducibility: cappedByTime
      ? 'This run was stopped by its wall-clock cap, not by finishing. Replaying the seed reproduces the same search, but a faster or slower machine will stop at a different point, so the reported metrics are machine-specific.'
      : 'This run finished before its wall-clock cap. Replaying it with the same N, the same parameters and the same seed reproduces this outcome exactly; only the millisecond timing is machine-specific.',
  };
}

/**
 * Hand the exported run to the reader as a file.
 *
 * A Blob URL and a synthetic click, because there is no backend to POST to and
 * this must keep working from a static Pages origin.
 */
export function exportRun(rec: RunRecord): void {
  const blob = new Blob([JSON.stringify(buildExport(rec), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `factor-forge-${rec.ctx.algorithm}-${rec.ctx.runId}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke on the next task, so the download has taken the reference first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
