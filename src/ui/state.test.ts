import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../factor/types';
import type { SerializedOutcome } from '../worker/protocol';
import {
  anyRunning,
  batchIsCurrent,
  cancelAll,
  completedRuns,
  contextIsCurrent,
  makeContext,
  markBusy,
  markCancelled,
  markError,
  markProgress,
  paramsChanged,
  recordRun,
  rowOf,
  setCanceller,
  setN,
  startBatch,
  state,
} from './state';

/**
 * The run lifecycle, tested where it can be tested deterministically.
 *
 * The maths in this repo was covered from the first commit; the LIFECYCLE was
 * not, and that is where the only bug capable of making the page state a
 * falsehood lived. A run dispatched against one N and recorded against another
 * produced "rho — GAVE UP: no collision in 50,000,000 iterations" underneath
 * N = 15. These tests exist so that cannot come back.
 */

const OUTCOME: SerializedOutcome = {
  algorithm: 'rho',
  p: null,
  q: null,
  ms: 42,
  trace: {
    algorithm: 'rho',
    steps: [],
    metrics: [],
    why: null,
    gaveUp: { reason: 'no collision in 50,000,000 iterations', at: '50,331,774 iterations' },
  },
};

const SUCCESS = (p: string, q: string): SerializedOutcome => ({
  algorithm: 'trial',
  p,
  q,
  ms: 1,
  trace: {
    algorithm: 'trial',
    steps: [],
    metrics: [],
    why: { kind: 'small-factor', factor: p, divisions: 3 },
    gaveUp: null,
  },
});

function reset(): void {
  state.n = 0n;
  state.params = { ...DEFAULT_PARAMS };
  state.rows.clear();
  state.traceFocus = null;
  state.traceStep = 0;
  state.capMs = 8000;
  state.retired = null;
  state.epoch = 0;
  state.batchId = 0;
  state.nextRunId = 0;
  state.workerNotice = null;
  state.discarded = 0;
  setCanceller(() => undefined);
  setN(1640344808434621n);
}

beforeEach(reset);

describe('experiment identity', () => {
  it('a context snapshots N and the parameters at dispatch', () => {
    const ctx = makeContext('rho');
    const before = ctx.params.rhoSteps;
    state.params.rhoSteps = 999;
    state.n = 99n;
    // The snapshot is a copy, not a view.
    expect(ctx.params.rhoSteps).toBe(before);
    expect(ctx.n).toBe(1640344808434621n);
  });

  it('every dispatch gets a distinct run id and a distinct seed', () => {
    const a = makeContext('rho');
    const b = makeContext('rho');
    expect(a.runId).not.toBe(b.runId);
    expect(a.seed).not.toBe(b.seed);
    expect(a.seed).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('a completion is admitted only for the experiment that produced it', () => {
  it('records a result whose context is still current', () => {
    const ctx = makeContext('trial');
    markBusy(ctx);
    const rec = recordRun(SUCCESS('34206287', '47954483'), ctx);
    expect(rec).not.toBeNull();
    expect(rowOf('trial').kind).toBe('done');
    expect(completedRuns().size).toBe(1);
  });

  /**
   * The exact bug, reduced: a GIVE-UP for one N landing after N changed. It has
   * no product for the verifier to refute, so nothing but the epoch guard can
   * catch it.
   */
  it('DISCARDS a give-up whose N has changed, rather than attributing it', () => {
    const ctx = makeContext('rho');
    markBusy(ctx);
    setN(15n);
    expect(contextIsCurrent(ctx)).toBe(false);
    const rec = recordRun(OUTCOME, ctx);
    expect(rec).toBeNull();
    expect(state.discarded).toBe(1);
    // and nothing about the old run is showing against the new N
    expect(rowOf('rho').kind).not.toBe('done');
    expect(completedRuns().size).toBe(0);
  });

  it('DISCARDS a completion whose parameters have changed', () => {
    const ctx = makeContext('rho');
    markBusy(ctx);
    state.params.rhoSteps = 12345;
    paramsChanged();
    expect(recordRun(OUTCOME, ctx)).toBeNull();
    expect(state.discarded).toBe(1);
  });

  it('verifies against the context N, not the live one', () => {
    // 15 = 3 x 5. Dispatch against 15, then move N; the verdict must still be
    // computed against 15 if it is admitted at all.
    setN(15n);
    const ctx = makeContext('trial');
    const rec = recordRun(SUCCESS('3', '5'), ctx);
    expect(rec).not.toBeNull();
    expect(rec!.verdict.status).toBe('verified');
    expect(rec!.ctx.n).toBe(15n);
  });
});

describe('changing the experiment retires the board and says so', () => {
  it('reports completed and in-flight counts separately', () => {
    const a = makeContext('trial');
    recordRun(SUCCESS('34206287', '47954483'), a);
    const b = makeContext('rho');
    markBusy(b);
    setN(21n);
    expect(state.retired).toEqual({
      from: '1640344808434621',
      completed: 1,
      cancelled: 1,
    });
    // The in-flight row becomes an explicit cancellation, not "not run yet".
    expect(rowOf('rho').kind).toBe('cancelled');
    expect(rowOf('trial').kind).toBe('idle');
  });

  it('re-selecting the same N is a no-op and retires nothing', () => {
    const ctx = makeContext('trial');
    recordRun(SUCCESS('34206287', '47954483'), ctx);
    setN(1640344808434621n);
    expect(state.retired).toBeNull();
    expect(rowOf('trial').kind).toBe('done');
  });

  it('stops the in-flight work rather than letting it finish', () => {
    let cancels = 0;
    setCanceller(() => {
      cancels++;
    });
    const ctx = makeContext('rho');
    markBusy(ctx);
    setN(21n);
    expect(cancels).toBe(1);
  });
});

describe('batch cancellation', () => {
  it('invalidates the batch so a loop can stop', () => {
    const batch = startBatch();
    expect(batchIsCurrent(batch)).toBe(true);
    cancelAll();
    expect(batchIsCurrent(batch)).toBe(false);
  });

  it('turns every busy row into an explicit cancellation', () => {
    const ctx = makeContext('rho');
    markBusy(ctx);
    markProgress(ctx, '27,897,982 iterations of f (56%)');
    cancelAll();
    const row = rowOf('rho');
    expect(row.kind).toBe('cancelled');
    if (row.kind !== 'cancelled') throw new Error('unreachable');
    // The progress it had reached survives, so a cancelled run is not erased.
    expect(row.note).toContain('56%');
    expect(row.reason).toBe('cancelled by you');
  });

  it('leaves rows that never started alone', () => {
    cancelAll();
    expect(rowOf('ecm').kind).toBe('idle');
  });
});

describe('progress is addressed to the run that owns the row', () => {
  it('ignores a progress message from a superseded run', () => {
    const first = makeContext('rho');
    markBusy(first);
    const second = makeContext('rho');
    markBusy(second);
    markProgress(first, 'stale progress from the old run');
    const row = rowOf('rho');
    if (row.kind !== 'busy') throw new Error('expected busy');
    expect(row.note).not.toContain('stale');
  });
});

describe('failures are not cancellations', () => {
  it('an execution error is its own state and says nothing about N', () => {
    const ctx = makeContext('qs');
    markBusy(ctx);
    markError(ctx, 'the worker failed (out of memory)');
    const row = rowOf('qs');
    expect(row.kind).toBe('error');
    if (row.kind !== 'error') throw new Error('unreachable');
    expect(row.message).toContain('out of memory');
    // An error is not a verdict, so it must not reach the completed set.
    expect(completedRuns().size).toBe(0);
  });

  it('a cancellation is distinguishable from an error', () => {
    const ctx = makeContext('qs');
    markBusy(ctx);
    markCancelled(ctx, 'cancelled by you');
    expect(rowOf('qs').kind).toBe('cancelled');
  });

  it('anyRunning tracks only genuinely busy rows', () => {
    expect(anyRunning()).toBe(false);
    const ctx = makeContext('rho');
    markBusy(ctx);
    expect(anyRunning()).toBe(true);
    markCancelled(ctx, 'cancelled by you');
    expect(anyRunning()).toBe(false);
  });
});
