/**
 * The single mutable store the panels read. Kept deliberately small: an N, the
 * outcomes seen for it, and the parameters. Every panel re-renders from here,
 * so a stale verdict cannot survive a change of N — changing N clears the
 * board, which the claims suite asserts.
 */

import type { AlgorithmId, Params } from '../factor/types';
import { DEFAULT_PARAMS } from '../factor/types';
import type { SerializedGenerated, SerializedOutcome } from '../worker/protocol';
import { verifyFactorization, type Verdict } from '../verify/verify';

export interface RunRecord {
  outcome: SerializedOutcome;
  /** Invariant I1: the verdict is computed by the verifier, never by the algorithm. */
  verdict: Verdict;
}

export interface AppState {
  n: bigint;
  params: Params;
  runs: Map<AlgorithmId, RunRecord>;
  running: Set<AlgorithmId>;
  traceFocus: AlgorithmId | null;
  traceStep: number;
  lastGenerated: SerializedGenerated | null;
  /** Per-algorithm wall-clock cap, in ms. Real, and shown on screen. */
  capMs: number;
  /**
   * Set when a change of N threw results away, so the page can SAY the board
   * was retired instead of silently emptying. Re-selecting the same N is a
   * no-op and must not set this.
   */
  retired: { from: string; count: number } | null;
}

export const state: AppState = {
  n: 0n,
  params: { ...DEFAULT_PARAMS },
  runs: new Map(),
  running: new Set(),
  traceFocus: null,
  traceStep: 0,
  lastGenerated: null,
  capMs: 8000,
  retired: null,
};

type Listener = () => void;
const listeners: Listener[] = [];

export function subscribe(fn: Listener): void {
  listeners.push(fn);
}

export function emit(): void {
  for (const fn of listeners) fn();
}

/** Changing N retires every verdict on the board — nothing survives the change. */
export function setN(n: bigint): void {
  if (state.n === n) return;
  state.retired = state.runs.size > 0 ? { from: String(state.n), count: state.runs.size } : null;
  state.n = n;
  state.runs.clear();
  state.running.clear();
  state.traceFocus = null;
  state.traceStep = 0;
  emit();
}

export function recordRun(outcome: SerializedOutcome): RunRecord {
  const record: RunRecord = {
    outcome,
    verdict: verifyFactorization({
      n: state.n,
      p: outcome.p === null ? null : BigInt(outcome.p),
      q: outcome.q === null ? null : BigInt(outcome.q),
    }),
  };
  state.runs.set(outcome.algorithm, record);
  state.running.delete(outcome.algorithm);
  state.retired = null;
  if (state.traceFocus === null) {
    state.traceFocus = outcome.algorithm;
    state.traceStep = 0;
  }
  emit();
  return record;
}
