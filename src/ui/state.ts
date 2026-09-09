/**
 * The store, built around one rule: EVERY RESULT BELONGS TO THE EXPERIMENT THAT
 * PRODUCED IT.
 *
 * The first version of this file did not have that rule, and the consequence was
 * the worst class of bug this lab can have. `recordRun` verified an outcome
 * against whatever `state.n` happened to hold when the promise resolved, while
 * the run had been dispatched against a completely different `state.n`. Start
 * Pollard rho on a 127-bit modulus, change N to 15 while it grinds, and twenty
 * seconds later the board reported:
 *
 *     rho — GAVE UP: no collision in 50,000,000 iterations
 *
 * against N = 15, where rho finds a factor instantly. Invariant I1 did not
 * catch it: the verifier re-multiplies p·q and refutes a mismatched product, so
 * a stale SUCCESS was caught — but a stale GIVE-UP has no product to check and
 * went straight through as `no-claim`. Give-up rows are exactly what this lab
 * teaches with ("that failure is a result about N"), so the one verdict class
 * the verifier could not see was the one carrying the lesson.
 *
 * So: a run is dispatched with an immutable `RunContext`, the context comes back
 * with the outcome, and a result is admitted only if its context still matches
 * the live experiment. Changing N or any parameter bumps the epoch AND cancels
 * in-flight work, so the discard path should never fire — it exists because
 * "should never" is not an argument.
 */

import type { AlgorithmId, Params } from '../factor/types';
import { DEFAULT_PARAMS } from '../factor/types';
import type { SerializedGenerated, SerializedOutcome } from '../worker/protocol';
import { verifyFactorization, type Verdict } from '../verify/verify';
import { BUILD } from './build';

/**
 * Everything that determines a result. Immutable once created: the params are
 * copied at dispatch, and `n` is a bigint (a value, not a reference), so a later
 * edit to `state` cannot reach backwards into a run already in flight.
 */
export interface RunContext {
  runId: number;
  /** The batch this belongs to. Cancel invalidates a whole batch at once. */
  batchId: number;
  /** Bumped by any change to N, the parameters, or the cap. */
  epoch: number;
  algorithm: AlgorithmId;
  n: bigint;
  params: Params;
  capMs: number;
  /** The seed the worker was given. Re-running with it reproduces the run. */
  seed: string;
  /** The code that produced it. */
  build: { version: string; commit: string; builtAt: string };
  startedAt: number;
}

export interface RunRecord {
  outcome: SerializedOutcome;
  /** Invariant I1: the verdict is computed by the verifier, never by the algorithm. */
  verdict: Verdict;
  /** Provenance. Every panel reads N and params from HERE, never from the store. */
  ctx: RunContext;
}

/** What a board row is currently showing. Exhaustive on purpose. */
export type RowState =
  | { kind: 'idle' }
  | { kind: 'busy'; ctx: RunContext; note: string }
  | { kind: 'done'; record: RunRecord }
  | { kind: 'cancelled'; ctx: RunContext; note: string; reason: string }
  | { kind: 'error'; ctx: RunContext; message: string };

export interface AppState {
  n: bigint;
  params: Params;
  /** Per-algorithm row state. The only place a verdict is allowed to live. */
  rows: Map<AlgorithmId, RowState>;
  traceFocus: AlgorithmId | null;
  traceStep: number;
  lastGenerated: SerializedGenerated | null;
  /** Per-algorithm wall-clock cap, in ms. Real, and shown on screen. */
  capMs: number;
  /**
   * Set when a change of experiment threw work away, so the page can SAY the
   * board was retired instead of silently emptying. Re-selecting the same N is
   * a no-op and must not set this.
   */
  retired: { from: string; completed: number; cancelled: number } | null;
  /** Bumped by any change to N, params or cap. */
  epoch: number;
  batchId: number;
  nextRunId: number;
  /**
   * Set when module workers are unavailable and factoring has fallen back to
   * the main thread. The page says so, because on that path a long run freezes
   * the tab and Cancel cannot honestly stop it.
   */
  workerNotice: string | null;
  /** Counts stale completions the epoch guard rejected. Shown, not hidden. */
  discarded: number;
}

export const state: AppState = {
  n: 0n,
  params: { ...DEFAULT_PARAMS },
  rows: new Map(),
  traceFocus: null,
  traceStep: 0,
  lastGenerated: null,
  capMs: 8000,
  retired: null,
  epoch: 0,
  batchId: 0,
  nextRunId: 0,
  workerNotice: null,
  discarded: 0,
};

type Listener = () => void;
const listeners: Listener[] = [];

/**
 * How the store stops work it has just invalidated.
 *
 * The store must not import the Runner (the Runner imports the algorithms, and
 * the store is what the verifier-facing panels read), so the dependency is
 * inverted: `main.ts` registers `runner.cancel` here. Without it, changing N
 * marked the in-flight row cancelled while the worker kept grinding to the end
 * of a 50-million-iteration search whose result could then only be thrown away.
 */
let canceller: (() => void) | null = null;

export function setCanceller(fn: () => void): void {
  canceller = fn;
}

export function subscribe(fn: Listener): void {
  listeners.push(fn);
}

export function emit(): void {
  for (const fn of listeners) fn();
}

export function rowOf(id: AlgorithmId): RowState {
  return state.rows.get(id) ?? { kind: 'idle' };
}

/** Completed runs only. Trace and Ladder read this rather than the raw rows. */
export function completedRuns(): Map<AlgorithmId, RunRecord> {
  const out = new Map<AlgorithmId, RunRecord>();
  for (const [id, row] of state.rows) {
    if (row.kind === 'done') out.set(id, row.record);
  }
  return out;
}

export function anyRunning(): boolean {
  for (const row of state.rows.values()) if (row.kind === 'busy') return true;
  return false;
}

/** A fresh 128-bit seed, hex. Recorded with the run so it can be replayed. */
export function freshSeed(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Snapshot the live experiment. Called at dispatch, never afterwards. */
export function makeContext(algorithm: AlgorithmId, seed = freshSeed()): RunContext {
  return {
    runId: ++state.nextRunId,
    batchId: state.batchId,
    epoch: state.epoch,
    algorithm,
    n: state.n,
    // Copied, not aliased. Params is a flat record of numbers, so a spread is a
    // complete copy; it matters on the inline fallback path, where the object
    // is handed to the algorithm directly instead of being structured-cloned
    // across the worker boundary.
    params: { ...state.params },
    capMs: state.capMs,
    seed,
    build: BUILD,
    startedAt: performance.now(),
  };
}

/** True while `ctx` still describes the live experiment. */
export function contextIsCurrent(ctx: RunContext): boolean {
  return ctx.epoch === state.epoch;
}

/**
 * Invalidate the current experiment: bump the epoch, and turn every in-flight
 * row into an explicit `cancelled` so nothing silently reverts to "not run yet".
 * Returns the number of rows it stopped.
 */
function invalidate(reason: string): { completed: number; cancelled: number } {
  state.epoch++;
  state.batchId++;
  // Stop the work FIRST. The epoch guard in recordRun would reject whatever
  // came back anyway, but letting a superseded search run to completion burns
  // the tab's CPU for a result that is guaranteed to be discarded.
  canceller?.();
  let completed = 0;
  let cancelled = 0;
  for (const [id, row] of state.rows) {
    if (row.kind === 'done') {
      completed++;
      state.rows.delete(id);
    } else if (row.kind === 'busy') {
      cancelled++;
      state.rows.set(id, { kind: 'cancelled', ctx: row.ctx, note: row.note, reason });
    } else if (row.kind === 'cancelled' || row.kind === 'error') {
      state.rows.delete(id);
    }
  }
  return { completed, cancelled };
}

/**
 * Changing N retires the board. Every verdict AND every run still in flight
 * belongs to the old N, so both go — and the page says how many of each.
 */
export function setN(n: bigint): void {
  if (state.n === n) return;
  const from = String(state.n);
  const { completed, cancelled } = invalidate('N changed while this was running');
  state.retired = completed + cancelled > 0 ? { from, completed, cancelled } : null;
  state.n = n;
  state.traceFocus = null;
  state.traceStep = 0;
  emit();
}

/**
 * A parameter change retires the board for the same reason: a verdict earned
 * under a different bound is not a verdict about this one.
 */
export function paramsChanged(): void {
  const { completed, cancelled } = invalidate('a parameter changed while this was running');
  state.retired =
    completed + cancelled > 0 ? { from: `${String(state.n)} under the previous bounds`, completed, cancelled } : null;
  state.traceFocus = null;
  state.traceStep = 0;
  emit();
}

/** Start a new batch and return its id. Cancel invalidates it by bumping past it. */
export function startBatch(): number {
  return ++state.batchId;
}

export function batchIsCurrent(batchId: number): boolean {
  return state.batchId === batchId;
}

/** Cancel: invalidate the batch, and mark every busy row cancelled. */
export function cancelAll(reason = 'cancelled by you'): void {
  state.batchId++;
  for (const [id, row] of state.rows) {
    if (row.kind === 'busy') {
      state.rows.set(id, { kind: 'cancelled', ctx: row.ctx, note: row.note, reason });
    }
  }
  emit();
}

export function markBusy(ctx: RunContext): void {
  state.rows.set(ctx.algorithm, { kind: 'busy', ctx, note: 'starting…' });
  emit();
}

export function markProgress(ctx: RunContext, note: string): void {
  const row = state.rows.get(ctx.algorithm);
  // Only the run that owns the row may write to it. A late progress message
  // from a superseded run must not repaint a row that now belongs to another.
  if (!row || row.kind !== 'busy' || row.ctx.runId !== ctx.runId) return;
  row.note = note;
}

export function markCancelled(ctx: RunContext, reason: string): void {
  const row = state.rows.get(ctx.algorithm);
  const note = row && row.kind === 'busy' ? row.note : '';
  if (row && row.kind !== 'busy' && row.kind !== 'idle') return;
  state.rows.set(ctx.algorithm, { kind: 'cancelled', ctx, note, reason });
  emit();
}

export function markError(ctx: RunContext, message: string): void {
  const row = state.rows.get(ctx.algorithm);
  if (row && row.kind === 'busy' && row.ctx.runId !== ctx.runId) return;
  state.rows.set(ctx.algorithm, { kind: 'error', ctx, message });
  emit();
}

/**
 * Admit a completed outcome — but only if its context still describes the live
 * experiment. A stale completion is counted and dropped, never rendered.
 *
 * The verdict is computed against `ctx.n`, the N the run was actually given,
 * not against `state.n`.
 */
export function recordRun(outcome: SerializedOutcome, ctx: RunContext): RunRecord | null {
  if (!contextIsCurrent(ctx)) {
    state.discarded++;
    const row = state.rows.get(ctx.algorithm);
    if (row && row.kind === 'busy' && row.ctx.runId === ctx.runId) state.rows.delete(ctx.algorithm);
    emit();
    return null;
  }
  const record: RunRecord = {
    outcome,
    verdict: verifyFactorization({
      n: ctx.n,
      p: outcome.p === null ? null : BigInt(outcome.p),
      q: outcome.q === null ? null : BigInt(outcome.q),
    }),
    ctx,
  };
  state.rows.set(ctx.algorithm, { kind: 'done', record });
  state.retired = null;
  if (state.traceFocus === null) {
    state.traceFocus = ctx.algorithm;
    state.traceStep = 0;
  }
  emit();
  return record;
}
