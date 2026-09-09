/**
 * Worker client.
 *
 * Three things this has to get right, each of which it got wrong once:
 *
 *  - CANCEL MUST CANCEL. Terminating the worker stops the job that is running;
 *    it does nothing about jobs the caller has not dispatched yet. The batch
 *    token lives in `state.ts`, but the queue lives here, so a cancel also has
 *    to empty the queue rather than let it drain.
 *  - A FAILURE IS NOT A CANCELLATION. Both used to arrive as a rejected promise
 *    and were caught by the same empty `catch`, so a genuine worker crash looked
 *    exactly like the user pressing Cancel: the row quietly went back to "not
 *    run yet". Results are now a discriminated union, so the caller cannot
 *    conflate them even by accident.
 *  - THE FALLBACK IS NOT EQUIVALENT. If module workers are unavailable the same
 *    maths runs on the main thread — but it freezes the tab and Cancel cannot
 *    stop a BigInt loop that has already entered. That is a different product,
 *    so the page is told to say so rather than pretending nothing changed.
 *
 * Jobs are queued and run one at a time. That is not just tidiness: the board
 * compares wall-clock timings across methods, and two jobs sharing a core would
 * make those numbers meaningless.
 */

import { REGISTRY } from '../factor/registry';
import { withSeed } from '../factor/rng';
import { factorTree } from '../factor/tree';
import { generateWeakN, type WeaknessTarget } from '../gen/weak';
import type { AlgorithmId, Params } from '../factor/types';
import type {
  SerializedGenerated,
  SerializedOutcome,
  WorkerRequest,
  WorkerResponse,
} from '../worker/protocol';
import type { TreeNode } from '../factor/tree';

/** Why a job did not produce an outcome. Never merged with success. */
export type RunFailure =
  | { ok: false; kind: 'cancelled' }
  | { ok: false; kind: 'error'; message: string };

export type RunResult<T> = ({ ok: true } & T) | RunFailure;

/** Omit must distribute over the request union, or every variant loses its own keys. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type RequestBody = DistributiveOmit<WorkerRequest, 'jobId'>;

type Resolver = {
  resolve: (value: WorkerResponse) => void;
  reject: (reason: Error) => void;
  onProgress?: (done: number, total: number, note: string) => void;
};

const CANCELLED = 'cancelled';

export class Runner {
  private worker: Worker | null = null;
  private pending = new Map<number, Resolver>();
  private nextId = 1;
  /** True once worker construction has failed; the fallback path is then used. */
  public inlineOnly = false;
  /** Set when the fallback engages, so the UI can say what changed. */
  public fallbackReason: string | null = null;
  /** Serialises jobs so wall-clock timings stay comparable. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Bumped by cancel(); a job whose token is stale never starts. */
  private token = 0;

  private ensureWorker(): Worker | null {
    if (this.inlineOnly) return null;
    if (this.worker) return this.worker;
    try {
      // The `new URL(..., import.meta.url)` form is what lets Vite emit the
      // worker as its own chunk and resolve it against the deployed base path,
      // so this keeps working under the GitHub Pages project subpath.
      const w = new Worker(new URL('../worker/factor.worker.ts', import.meta.url), {
        type: 'module',
      });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => this.dispatch(e.data);
      w.onerror = (e) => {
        this.degrade(`the worker stopped with an error${e.message ? `: ${e.message}` : ''}`);
        for (const [, r] of this.pending) r.reject(new Error('worker failed'));
        this.pending.clear();
      };
      this.worker = w;
      return w;
    } catch (err) {
      this.degrade(
        `this browser would not start a module worker (${err instanceof Error ? err.message : String(err)})`
      );
      return null;
    }
  }

  /** Fall back to the main thread, and remember why so the page can say it. */
  private degrade(reason: string): void {
    this.inlineOnly = true;
    this.fallbackReason = reason;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private dispatch(msg: WorkerResponse): void {
    const entry = this.pending.get(msg.jobId);
    if (!entry) return;
    if (msg.kind === 'progress') {
      entry.onProgress?.(msg.done, msg.total, msg.note);
      return;
    }
    this.pending.delete(msg.jobId);
    if (msg.kind === 'failed') entry.reject(new Error(msg.message));
    else entry.resolve(msg);
  }

  /**
   * Stop everything: the running job, and every job still queued behind it.
   * Bumping the token is what stops the queue — terminating the worker alone
   * would let the next queued job start on a freshly-built one.
   */
  cancel(): void {
    this.token++;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const [, r] of this.pending) r.reject(new Error(CANCELLED));
    this.pending.clear();
  }

  /** True when work can be stopped mid-flight. False on the inline fallback. */
  get cancellable(): boolean {
    return !this.inlineOnly;
  }

  private send(req: RequestBody, onProgress?: Resolver['onProgress']): Promise<WorkerResponse> {
    const worker = this.ensureWorker();
    if (!worker) return Promise.reject(new Error('no worker'));
    const jobId = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(jobId, { resolve, reject, onProgress });
      worker.postMessage({ ...req, jobId } as WorkerRequest);
    });
  }

  /** Run `fn` after everything already queued, unless cancelled first. */
  private enqueue<T>(fn: () => Promise<RunResult<T>>): Promise<RunResult<T>> {
    const myToken = this.token;
    const run = this.queue.then(async (): Promise<RunResult<T>> => {
      if (myToken !== this.token) return { ok: false, kind: 'cancelled' };
      return fn();
    });
    // The chain must never reject, or one failure would poison every later job.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async attempt<T>(
    viaWorker: () => Promise<T>,
    inline: () => T
  ): Promise<RunResult<T>> {
    if (!this.inlineOnly) {
      try {
        return { ok: true, ...(await viaWorker()) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === CANCELLED) return { ok: false, kind: 'cancelled' };
        // A worker that failed is a worker we cannot trust; fall through to the
        // main thread and record why, so the page can warn about it.
        this.degrade(`the worker failed (${message})`);
      }
    }
    try {
      return { ok: true, ...inline() };
    } catch (err) {
      return { ok: false, kind: 'error', message: err instanceof Error ? err.message : String(err) };
    }
  }

  factor(
    algorithm: AlgorithmId,
    n: bigint,
    params: Params,
    maxMs: number,
    seed: string,
    onProgress?: (done: number, total: number, note: string) => void
  ): Promise<RunResult<{ outcome: SerializedOutcome }>> {
    return this.enqueue(() =>
      this.attempt(
        async () => {
          const res = await this.send(
            { kind: 'factor', algorithm, n: String(n), params, maxMs, seed },
            onProgress
          );
          if (res.kind !== 'factored') throw new Error('unexpected worker response');
          return { outcome: res.outcome };
        },
        () => {
          // The seed must be applied HERE too. It was not, once: the worker path
          // honoured it and the fallback quietly ignored it, so an exported run
          // could name a seed that did not reproduce the run it came from --
          // which is worse than having no seed at all, because it looks like
          // provenance.
          const out = withSeed(seed, () => REGISTRY[algorithm](n, params, { maxMs }));
          return {
            outcome: {
              algorithm,
              p: out.p === null ? null : String(out.p),
              q: out.q === null ? null : String(out.q),
              ms: out.ms,
              trace: out.trace,
            },
          };
        }
      )
    );
  }

  generate(
    target: WeaknessTarget,
    bits: number,
    params: Params,
    seed: string
  ): Promise<RunResult<{ result: SerializedGenerated }>> {
    return this.enqueue(() =>
      this.attempt(
        async () => {
          const res = await this.send({ kind: 'generate', target, bits, params, seed });
          if (res.kind !== 'generated') throw new Error('unexpected worker response');
          return { result: res.result };
        },
        () => {
          const g = withSeed(seed, () => generateWeakN(target, { bits, params }));
          return {
            result: {
              target: g.target,
              n: String(g.n),
              p: String(g.p),
              q: String(g.q),
              bits: g.bits,
              evidence: g.evidence,
              proof: g.proof,
              attempts: g.attempts,
            },
          };
        }
      )
    );
  }

  tree(
    n: bigint,
    params: Params,
    maxMs: number
  ): Promise<RunResult<{ root: TreeNode; ms: number }>> {
    return this.enqueue(() =>
      this.attempt(
        async () => {
          const res = await this.send({ kind: 'tree', n: String(n), params, maxMs });
          if (res.kind !== 'tree') throw new Error('unexpected worker response');
          return { root: res.root, ms: res.ms };
        },
        () => {
          const t0 = performance.now();
          const root = factorTree(n, params, { maxMs });
          return { root, ms: performance.now() - t0 };
        }
      )
    );
  }
}
